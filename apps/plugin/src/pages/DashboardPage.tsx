import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { dateTimeParse, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import { type DashboardFilters, emptyFilters } from '../dashboard/types';
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar';
import { DashboardGrid } from '../components/dashboard/DashboardGrid';
import { useLabelNames } from '../components/dashboard/useLabelNames';
import { useLabelValues } from '../components/dashboard/useLabelValues';

type DashboardPageProps = {
  dataSource?: DashboardDataSource;
};

const defaultTimeRange: TimeRange = {
  from: dateTimeParse('now-1h'),
  to: dateTimeParse('now'),
  raw: { from: 'now-1h', to: 'now' },
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
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);
  const [filters, setFilters] = useState<DashboardFilters>(emptyFilters);

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);

  const labelNames = useLabelNames(dataSource, from, to);

  const providerValues = useLabelValues(dataSource, 'gen_ai_provider_name', from, to);
  const modelValues = useLabelValues(dataSource, 'gen_ai_request_model', from, to);
  const agentValues = useLabelValues(dataSource, 'gen_ai_agent_name', from, to);
  const dynamicLabelValues = useLabelValues(dataSource, filters.labelKey, from, to);

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

  const handleTimeRangeChange = useCallback((newTimeRange: TimeRange) => {
    setTimeRange(newTimeRange);
  }, []);

  const handleFiltersChange = useCallback((newFilters: DashboardFilters) => {
    setFilters(newFilters);
  }, []);

  return (
    <div className={styles.container}>
      <DashboardFilterBar
        timeRange={timeRange}
        filters={filters}
        providerOptions={providerValues.values}
        modelOptions={modelValues.values}
        agentOptions={agentValues.values}
        labelKeyOptions={labelKeyOptions}
        labelValueOptions={dynamicLabelValues.values}
        labelsLoading={labelNames.loading}
        labelValuesLoading={dynamicLabelValues.loading}
        onTimeRangeChange={handleTimeRangeChange}
        onFiltersChange={handleFiltersChange}
      />
      <DashboardGrid dataSource={dataSource} filters={filters} from={from} to={to} timeRange={timeRange} />
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      padding: theme.spacing(2),
    }),
  };
}
