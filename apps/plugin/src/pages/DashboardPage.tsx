import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { type GrafanaTheme2 } from '@grafana/data';
import { Tab, TabsBar, useStyles2 } from '@grafana/ui';
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import { type DashboardTab } from '../dashboard/types';
import { useDashboardUrlState } from '../dashboard/useDashboardUrlState';
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar';
import { DashboardGrid } from '../components/dashboard/DashboardGrid';
import { DashboardPerformanceGrid } from '../components/dashboard/DashboardPerformanceGrid';
import { DashboardErrorsGrid } from '../components/dashboard/DashboardErrorsGrid';
import { DashboardUsageGrid } from '../components/dashboard/DashboardUsageGrid';
import { DashboardEvalGrid } from '../components/dashboard/DashboardEvalGrid';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';
import { LandingTopBar } from '../components/landing/LandingTopBar';

type DashboardPageProps = {
  dataSource?: DashboardDataSource;
};

const LABEL_FILTER_ROW_STORAGE_KEY = 'sigil.dashboard.labelFilterRowOpen';

export default function DashboardPage({ dataSource = defaultDashboardDataSource }: DashboardPageProps) {
  const styles = useStyles2(getStyles);
  const { timeRange, filters, breakdownBy, tab, setTimeRange, setFilters, setBreakdownBy, setTab } =
    useDashboardUrlState();
  const [showLabelFilterRow, setShowLabelFilterRow] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.sessionStorage.getItem(LABEL_FILTER_ROW_STORAGE_KEY) === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(LABEL_FILTER_ROW_STORAGE_KEY, showLabelFilterRow ? '1' : '0');
  }, [showLabelFilterRow]);

  const handleTabChange = useCallback(
    (newTab: DashboardTab) => () => {
      setTab(newTab);
    },
    [setTab]
  );

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);

  const { providerOptions, modelOptions, agentOptions, labelKeyOptions, labelsLoading } = useCascadingFilterOptions(
    dataSource,
    filters,
    from,
    to
  );

  return (
    <div className={styles.container}>
      <LandingTopBar
        assistantOrigin="grafana/sigil-plugin/dashboard"
        requestsDataSource={dataSource}
        requestsFrom={from}
        requestsTo={to}
        compact
      />
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
        showLabelFilters={tab !== 'evaluation'}
        showLabelFilterRow={showLabelFilterRow}
        onLabelFilterRowOpenChange={setShowLabelFilterRow}
        onTimeRangeChange={setTimeRange}
        onFiltersChange={setFilters}
        onBreakdownChange={setBreakdownBy}
      />
      <TabsBar>
        <Tab label="Overview" active={tab === 'overview'} onChangeTab={handleTabChange('overview')} />
        <Tab label="Performance" active={tab === 'performance'} onChangeTab={handleTabChange('performance')} />
        <Tab label="Errors" active={tab === 'errors'} onChangeTab={handleTabChange('errors')} />
        <Tab label="Usage" active={tab === 'usage'} onChangeTab={handleTabChange('usage')} />
        <Tab label="Evaluation" active={tab === 'evaluation'} onChangeTab={handleTabChange('evaluation')} />
      </TabsBar>
      {tab === 'overview' && (
        <DashboardGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
      )}
      {tab === 'performance' && (
        <DashboardPerformanceGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
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
          onTimeRangeChange={setTimeRange}
        />
      )}
      {tab === 'usage' && (
        <DashboardUsageGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
      )}
      {tab === 'evaluation' && (
        <DashboardEvalGrid
          dataSource={dataSource}
          filters={filters}
          breakdownBy={breakdownBy}
          from={from}
          to={to}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
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
      marginTop: theme.spacing(-2),
    }),
  };
}
