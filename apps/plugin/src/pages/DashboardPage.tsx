import React, { useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { type GrafanaTheme2 } from '@grafana/data';
import { Tab, TabsBar, useStyles2 } from '@grafana/ui';
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import { type DashboardTab } from '../dashboard/types';
import { useDashboardUrlState } from '../dashboard/useDashboardUrlState';
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar';
import { DashboardGrid } from '../components/dashboard/DashboardGrid';
import { DashboardErrorsGrid } from '../components/dashboard/DashboardErrorsGrid';
import { DashboardConsumptionGrid } from '../components/dashboard/DashboardConsumptionGrid';
import { DashboardCacheGrid } from '../components/dashboard/DashboardCacheGrid';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';

type DashboardPageProps = {
  dataSource?: DashboardDataSource;
};

export default function DashboardPage({ dataSource = defaultDashboardDataSource }: DashboardPageProps) {
  const styles = useStyles2(getStyles);
  const { timeRange, filters, breakdownBy, tab, setTimeRange, setFilters, setBreakdownBy, setTab } =
    useDashboardUrlState();

  const handleTabChange = useCallback(
    (newTab: DashboardTab) => () => {
      setTab(newTab);
    },
    [setTab]
  );

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);

  const { providerOptions, modelOptions, agentOptions, labelKeyOptions, labelsLoading } =
    useCascadingFilterOptions(dataSource, filters, from, to);

  return (
    <div className={styles.container}>
      <DashboardFilterBar
        timeRange={timeRange}
        filters={filters}
        breakdownBy={breakdownBy}
        providerOptions={providerOptions}
        modelOptions={modelOptions}
        agentOptions={agentOptions}
        labelKeyOptions={labelKeyOptions}
        labelsLoading={labelsLoading}
        dataSource={dataSource}
        from={from}
        to={to}
        onTimeRangeChange={setTimeRange}
        onFiltersChange={setFilters}
        onBreakdownChange={setBreakdownBy}
      />
      <TabsBar>
        <Tab label="Overview" active={tab === 'overview'} onChangeTab={handleTabChange('overview')} />
        <Tab label="Errors" active={tab === 'errors'} onChangeTab={handleTabChange('errors')} />
        <Tab label="Consumption" active={tab === 'consumption'} onChangeTab={handleTabChange('consumption')} />
        <Tab label="Cache" active={tab === 'cache'} onChangeTab={handleTabChange('cache')} />
      </TabsBar>
      {tab === 'overview' && (
        <DashboardGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
        />
      )}
      {tab === 'errors' && (
        <DashboardErrorsGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
        />
      )}
      {tab === 'consumption' && (
        <DashboardConsumptionGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
        />
      )}
      {tab === 'cache' && (
        <DashboardCacheGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
        />
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
    }),
  };
}
