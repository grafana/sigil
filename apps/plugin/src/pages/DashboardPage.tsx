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
import { useLabelNames } from '../components/dashboard/useLabelNames';
import { useLabelValues } from '../components/dashboard/useLabelValues';

type DashboardPageProps = {
  dataSource?: DashboardDataSource;
};

const noiseLabels = new Set(['__name__', 'le', 'quantile']);

function labelPriority(label: string): number {
  if (label.startsWith('gen_ai_')) {
    return 0;
  }
  if (label.startsWith('telemetry_') || label.includes('service') || label === 'job' || label === 'instance') {
    return 1;
  }
  return 2;
}

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

  // Cascading matchers: provider restricts model options, provider+model restricts agent options.
  const providerMatcher = useMemo(() => {
    if (!filters.provider) {
      return undefined;
    }
    return `{gen_ai_provider_name="${filters.provider}"}`;
  }, [filters.provider]);

  const providerAndModelMatcher = useMemo(() => {
    const parts: string[] = [];
    if (filters.provider) {
      parts.push(`gen_ai_provider_name="${filters.provider}"`);
    }
    if (filters.model) {
      parts.push(`gen_ai_request_model="${filters.model}"`);
    }
    return parts.length > 0 ? `{${parts.join(',')}}` : undefined;
  }, [filters.provider, filters.model]);

  const providerValues = useLabelValues(dataSource, 'gen_ai_provider_name', from, to);
  const modelValues = useLabelValues(dataSource, 'gen_ai_request_model', from, to, providerMatcher);
  const agentValues = useLabelValues(dataSource, 'gen_ai_agent_name', from, to, providerAndModelMatcher);

  const labelNames = useLabelNames(dataSource, from, to);

  const labelKeyOptions = useMemo(() => {
    const merged = new Set<string>([
      ...labelNames.names,
      'gen_ai_provider_name',
      'gen_ai_request_model',
      'gen_ai_agent_name',
    ]);
    return Array.from(merged)
      .filter((label) => !noiseLabels.has(label))
      .sort((a, b) => {
        const byPriority = labelPriority(a) - labelPriority(b);
        if (byPriority !== 0) {
          return byPriority;
        }
        return a.localeCompare(b);
      });
  }, [labelNames.names]);

  return (
    <div className={styles.container}>
      <DashboardFilterBar
        timeRange={timeRange}
        filters={filters}
        breakdownBy={breakdownBy}
        providerOptions={providerValues.values}
        modelOptions={modelValues.values}
        agentOptions={agentValues.values}
        labelKeyOptions={labelKeyOptions}
        labelsLoading={labelNames.loading}
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
