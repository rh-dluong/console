import {
    AcmDonutChart,
    AcmLabels,
    AcmTable,
} from '@open-cluster-management/ui-components'
import React from 'react'
import _ from 'lodash'
import { makeStyles } from '@material-ui/styles'
import { useTranslation } from 'react-i18next'
import { ISearchResult } from '../../../../lib/search'

const useStyles = makeStyles({
    sidebarDescText: {
        fontSize: '14px',
        paddingBottom: '1rem'
    },
    donutContainer: {
        paddingBottom: '.5rem'
    }
})

export function ClusterPolicySidebar(props: { data: ISearchResult[], loading: boolean }) {
    const classes = useStyles()
    const { t } = useTranslation(['cluster'])
    const clusterIssues = _.get(props, 'data[0].data.searchResult[0].items', [])
    const clusterRiskScores = clusterIssues.map((issue: any) => issue.risk)

    return(
        <div>
            <div className={classes.sidebarDescText}>
                {t('policy.report.flyout.description')}
            </div>
            <div className={classes.donutContainer}>
                <AcmDonutChart
                    loading={props.loading ?? true}
                    title='Total issues'
                    description={'char desc'}
                    data={[
                        {
                            key: 'Critical',
                            value: clusterRiskScores.filter((score: string) => score === '4').length,
                            isPrimary: true,
                        },
                        {
                            key: 'Major',
                            value: clusterRiskScores.filter((score: string) => score === '3').length,
                        },
                        {
                            key: 'Minor',
                            value: clusterRiskScores.filter((score: string) => score === '2').length,
                        },
                        {
                            key: 'Low',
                            value: clusterRiskScores.filter((score: string) => score === '1').length,
                        },
                        {
                            key: 'Warning',
                            value: clusterRiskScores.filter((score: string) => score === '0').length,
                        },
                    ]}
                    colorScale={['#E62325', '#EC7A08', '#F4C145', '#2B9AF3', '#72767B']}
                />
            </div>
            {/* TODO Loading table */}
            <AcmTable
                plural="Recommendations"
                items={clusterIssues}
                columns={[
                    {
                        header: 'Description',
                        sort: 'message',
                        // search: 'message',
                        cell: 'message',
                    },
                    {
                        header: 'Category',
                        sort: 'category',
                        // search: 'category',
                        cell: (item: any) => {
                            if (item.category) {
                                const labels = item.label.split(',')
                                const labelsToHide = labels.slice(1)
                                return <AcmLabels labels={labels} collapse={labelsToHide} />
                            }
                            return '-'
                        },
                    },
                    {
                        header: 'Total risk',
                        sort: 'risk',
                        // search: 'risk',
                        cell: 'risk',
                    },
                ]}
                keyFn={(item: any) => item._uid.toString()}
                tableActions={[]}
                bulkActions={[]}
                rowActions={[]}
            />
        </div>
    )
}
