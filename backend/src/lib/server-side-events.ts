import { constants, Http2ServerRequest, Http2ServerResponse } from 'http2'
import { clearInterval } from 'timers'
import { flushStream, getEncodeStream } from './compression'
import { logger } from './logger'

const {
    HTTP2_HEADER_CONTENT_TYPE,
    HTTP_STATUS_OK,
    HTTP2_HEADER_CACHE_CONTROL,
    HTTP2_HEADER_CONTENT_ENCODING,
    HTTP2_HEADER_ACCEPT_ENCODING,
} = constants

export interface IEvent {
    id?: string
    name?: string
    namespace?: string
    data?: unknown
}

export interface IEventClient {
    events?: Record<string, boolean>
    namespaces?: Record<string, boolean>
    writableStream: NodeJS.WritableStream
    eventQueue: Promise<IEvent>[]
    processing?: boolean
}

export class ServerSideEvents {
    private static eventID = 0
    private static events: Record<number, IEvent> = {}
    private static clients: Record<string, IEventClient> = {}

    public static eventFilter: (clientID: string, event: Readonly<IEvent>) => Promise<IEvent | undefined>

    public static dispose(): Promise<void> {
        for (const clientID in this.clients) {
            this.clients[clientID].writableStream.end()
        }

        this.clients = {}

        if (ServerSideEvents.intervalTimer !== undefined) {
            clearInterval(ServerSideEvents.intervalTimer)
            ServerSideEvents.intervalTimer = undefined
        }

        return Promise.resolve()
    }

    public static pushEvent(event: IEvent): number {
        const eventID = ++this.eventID
        event.id = eventID.toString()
        this.events[eventID] = event
        this.broadcastEvent(eventID, event, true)
        return eventID
    }

    private static broadcastEvent(eventID: number, event: IEvent, flush = true): void {
        for (const clientID in this.clients) {
            this.sendEvent(clientID, event)
        }
    }

    private static sendEvent(clientID: string, event: IEvent): void {
        const client = this.clients[clientID]
        if (!client) return
        if (client.events && !client.events[event.name]) return
        if (client.namespaces && !client.namespaces[event.namespace]) return
        if (this.eventFilter) {
            client.eventQueue.push(this.eventFilter(clientID, event).catch((err) => undefined))
        } else {
            client.eventQueue.push(Promise.resolve(event))
        }
        void this.processClient(clientID)
    }

    private static async processClient(clientID: string): Promise<void> {
        const client = this.clients[clientID]
        if (!client) return
        if (client.processing) return
        client.processing = true
        while (client.eventQueue.length) {
            try {
                const event = await client.eventQueue.shift()
                if (event) {
                    const eventString = this.createEventString(event)
                    client.writableStream.write(eventString, 'utf8')
                    const watchEvent = event.data as {
                        type: string
                        object: {
                            apiVersion: string
                            kind: string
                            metadata: { name: string; namespace: string }
                        }
                    }
                    const { apiVersion, kind, metadata } = watchEvent.object
                    const name = metadata?.name
                    const namespace = metadata?.namespace
                    logger.debug({ msg: 'event', type: watchEvent.type, kind, name, namespace })
                }
            } catch (err) {
                logger.error(err)
            }
        }
        flushStream(client.writableStream)
        client.processing = false
    }

    private static createEventString(event: IEvent): string {
        let eventString = `id:${event.id}\n`
        if (event.name) eventString += `event:${event.name}\n`
        switch (typeof event.data) {
            case 'string':
            case 'number':
            case 'bigint':
                eventString += `data:${event.data}\n`
                break
            case 'boolean':
                eventString += `data:${event.data ? 'true' : 'false'}\n`
                break
            case 'object':
                try {
                    eventString += `data:${JSON.stringify(event.data)}\n`
                } catch (err) {
                    logger.error(err)
                    return
                }
                break
            default:
                return
        }
        eventString += '\n'
        return eventString
    }

    public static removeEvent(eventID: number): void {
        delete this.events[eventID]
    }

    public static handleRequest(clientID: string, req: Http2ServerRequest, res: Http2ServerResponse): IEventClient {
        const [writableStream, encoding] = getEncodeStream(
            (res as unknown) as NodeJS.WritableStream,
            req.headers[HTTP2_HEADER_ACCEPT_ENCODING] as string
        )

        let events: Record<string, boolean>
        let namespaces: Record<string, boolean>
        const queryStringIndex = req.url.indexOf('?')
        if (queryStringIndex !== -1) {
            const queryString = req.url.substr(queryStringIndex + 1)
            const parts = queryString.split('&')
            for (const part of parts) {
                if (part.startsWith('events=')) {
                    events = part
                        .substr(7)
                        .split(',')
                        .reduce((events, event) => {
                            events[event] = true
                            return events
                        }, {} as Record<string, boolean>)
                } else if (part.startsWith('namespaces=')) {
                    namespaces = part
                        .substr(11)
                        .split(',')
                        .reduce((namespaces, namespace) => {
                            namespaces[namespace] = true
                            return namespaces
                        }, {} as Record<string, boolean>)
                }
            }
        }
        const eventClient: IEventClient = {
            events,
            namespaces,
            writableStream,
            eventQueue: [],
        }
        this.clients[clientID] = eventClient

        res.setTimeout(2147483647)
        res.writeHead(HTTP_STATUS_OK, {
            [HTTP2_HEADER_CONTENT_TYPE]: 'text/event-stream',
            [HTTP2_HEADER_CACHE_CONTROL]: 'no-store, no-transform',
            [HTTP2_HEADER_CONTENT_ENCODING]: encoding,
        })
        res.on('close', () => {
            if (this.clients[clientID].writableStream === writableStream) {
                delete this.clients[clientID]
            }
        })

        let lastEventID = 0
        if (req.headers['last-event-id']) {
            const last = Number(req.headers['last-event-id'])
            if (Number.isInteger(last)) lastEventID = last
        }

        writableStream.write('retry: 15000\n\n')
        flushStream(writableStream)

        for (const eventID in this.events) {
            if (Number(eventID) <= lastEventID) continue
            this.sendEvent(clientID, this.events[eventID])
        }

        return eventClient
    }

    private static keepAlivePing(): void {
        for (const clientID in this.clients) {
            const clientStream = this.clients[clientID].writableStream
            try {
                clientStream.write('\n\n')
                flushStream(clientStream)
            } catch (err) {
                logger.error(err)
            }
        }
    }
    private static intervalTimer: NodeJS.Timer | undefined = setInterval(() => {
        ServerSideEvents.keepAlivePing()
    }, 110 * 1000)
}