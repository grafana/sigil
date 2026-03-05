import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { ThresholdsMode, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Select, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type LatencyPercentile,
  breakdownToPromLabel,
} from '../../dashboard/types';
import { BreakdownStatPanel } from './dashboardShared';
import { TopStat } from '../TopStat';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  latencyStatQuery,
  latencyOverTimeQuery,
  ttftOverTimeQuery,
  ttftStatQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { PageInsightBar } from '../insight/PageInsightBar';
import { summarizeVector, summarizeMatrix, hasResponseData } from '../insight/summarize';

export type DashboardPerformanceGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
};

const CHART_HEIGHT = 320;

const latencyPercentileOptions: Array<{ label: string; value: LatencyPercentile }> = [
  { label: 'P50', value: 'p50' },
  { label: 'P95', value: 'p95' },
  { label: 'P99', value: 'p99' },
];

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardPerformanceGrid({
  dataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
}: DashboardPerformanceGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;
  const [latencyPercentile, setLatencyPercentile] = useState<LatencyPercentile>('p95');

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  const latencyQuantileMap: Record<LatencyPercentile, number> = { p50: 0.5, p95: 0.95, p99: 0.99 };
  const quantile = latencyQuantileMap[latencyPercentile];

  // --- Top stats (P50 / P95 / P99 latency + TTFT P95) ---
  const latencyP50 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.5),
    from,
    to,
    'instant'
  );
  const latencyP95 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );
  const latencyP99 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.99),
    from,
    to,
    'instant'
  );
  const ttftP95 = usePrometheusQuery(
    dataSource,
    ttftStatQuery(filters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );

  // --- Previous period comparison ---
  const hourAgo = 3600;
  const prevFrom = from - hourAgo;
  const prevTo = to - hourAgo;
  const prevLatencyP95 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevTtftP95 = usePrometheusQuery(
    dataSource,
    ttftStatQuery(filters, rangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );

  // --- Latency over time ---
  const latencyTimeseries = usePrometheusQuery(
    dataSource,
    latencyOverTimeQuery(filters, interval, breakdownBy, quantile),
    from,
    to,
    'range',
    step
  );

  // --- Latency breakdown stat ---
  const latencyStat = usePrometheusQuery(
    dataSource,
    hasBreakdown ? latencyStatQuery(filters, rangeDuration, breakdownBy, quantile) : '',
    from,
    to,
    'instant'
  );

  // --- TTFT over time ---
  const ttftTimeseries = usePrometheusQuery(
    dataSource,
    ttftOverTimeQuery(filters, interval, breakdownBy, quantile),
    from,
    to,
    'range',
    step
  );

  // --- TTFT breakdown stat ---
  const ttftStat = usePrometheusQuery(
    dataSource,
    hasBreakdown ? ttftStatQuery(filters, rangeDuration, breakdownBy, quantile) : '',
    from,
    to,
    'instant'
  );

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const chartOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };

  // --- Insight ---
  const allDataLoading = latencyP95.loading || ttftP95.loading || latencyTimeseries.loading || ttftTimeseries.loading;
  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const hasAnyData =
      hasResponseData(latencyP95.data) ||
      hasResponseData(ttftP95.data) ||
      hasResponseData(latencyTimeseries.data) ||
      hasResponseData(ttftTimeseries.data);
    if (!hasAnyData) {
      return null;
    }
    return [
      'Performance dashboard context:',
      `Breakdown: ${breakdownBy}`,
      `Latency percentile: ${latencyPercentile}`,
      '',
      summarizeVector(latencyP50.data, 'Latency P50 (seconds)'),
      summarizeVector(latencyP95.data, 'Latency P95 (seconds)'),
      summarizeVector(latencyP99.data, 'Latency P99 (seconds)'),
      summarizeVector(ttftP95.data, 'TTFT P95 (seconds)'),
      summarizeMatrix(latencyTimeseries.data, 'Latency over time'),
      summarizeMatrix(ttftTimeseries.data, 'TTFT over time'),
    ].join('\n');
  }, [
    allDataLoading,
    breakdownBy,
    latencyPercentile,
    latencyP50.data,
    latencyP95.data,
    latencyP99.data,
    ttftP95.data,
    latencyTimeseries.data,
    ttftTimeseries.data,
  ]);

  const insightPrompt = `Analyze this GenAI performance dashboard. Breakdown: ${breakdownBy}. Latency percentile: ${latencyPercentile}. Only flag significant findings — latency anomalies, TTFT outliers, model-specific slowness, or actionable issues. Skip anything that looks normal.`;

  const latencyP50Value = latencyP50.data ? vectorToStatValue(latencyP50.data) : 0;
  const latencyP95Value = latencyP95.data ? vectorToStatValue(latencyP95.data) : 0;
  const latencyP99Value = latencyP99.data ? vectorToStatValue(latencyP99.data) : 0;
  const ttftP95Value = ttftP95.data ? vectorToStatValue(ttftP95.data) : 0;

  const prevLatencyP95Value = prevLatencyP95.data ? vectorToStatValue(prevLatencyP95.data) : 0;
  const prevTtftP95Value = prevTtftP95.data ? vectorToStatValue(prevTtftP95.data) : 0;

  return (
    <div className={styles.gridWrapper}>
      <div className={styles.statsRow}>
        <TopStat label="Latency (P50)" value={latencyP50Value} unit="s" loading={latencyP50.loading} invertChange />
        <TopStat
          label="Latency (P95)"
          value={latencyP95Value}
          unit="s"
          loading={latencyP95.loading}
          prevValue={prevLatencyP95Value}
          prevLoading={prevLatencyP95.loading}
          invertChange
        />
        <TopStat label="Latency (P99)" value={latencyP99Value} unit="s" loading={latencyP99.loading} invertChange />
        <TopStat
          label="Time to First Token (P95)"
          value={ttftP95Value}
          unit="s"
          loading={ttftP95.loading}
          prevValue={prevTtftP95Value}
          prevLoading={prevTtftP95.loading}
          invertChange
        />
      </div>
      <PageInsightBar
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-performance-insight"
        dataContext={insightDataContext}
        systemPrompt="You are a concise observability analyst. Return exactly 3-5 high-confidence suggestions. Include only suggestions strongly supported by the provided data; omit uncertain ideas. Each suggestion is a single short sentence on its own line prefixed with '- '. Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only."
      />

      <div className={styles.grid}>
        {/* Row 1: Latency over time */}
        <div className={hasBreakdown ? styles.panelRowWithStat : styles.panelRowFull}>
          <MetricPanel
            title="Latency"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={latencyTimeseries.loading}
            error={latencyTimeseries.error}
            data={latencyTimeseries.data ? matrixToDataFrames(latencyTimeseries.data) : []}
            options={chartOptions}
            fieldConfig={{
              defaults: { unit: 's', color: consistentColor, custom: timeseriesDefaults, thresholds: noThresholds },
              overrides: [],
            }}
            titleItems={
              <Select
                options={latencyPercentileOptions}
                value={latencyPercentile}
                onChange={(v) => {
                  if (v.value) {
                    setLatencyPercentile(v.value);
                  }
                }}
                width={10}
              />
            }
          />
          {hasBreakdown && (
            <BreakdownStatPanel
              title={`Avg Latency (${latencyPercentile.toUpperCase()})`}
              data={latencyStat.data}
              loading={latencyStat.loading}
              error={latencyStat.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
              unit="s"
              aggregation="avg"
            />
          )}
        </div>

        {/* Row 2: Time to First Token */}
        <div className={hasBreakdown ? styles.panelRowWithStat : styles.panelRowFull}>
          <MetricPanel
            title="Time to First Token"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={ttftTimeseries.loading}
            error={ttftTimeseries.error}
            data={ttftTimeseries.data ? matrixToDataFrames(ttftTimeseries.data) : []}
            options={chartOptions}
            fieldConfig={{
              defaults: { unit: 's', color: consistentColor, custom: timeseriesDefaults, thresholds: noThresholds },
              overrides: [],
            }}
            titleItems={
              <Select
                options={latencyPercentileOptions}
                value={latencyPercentile}
                onChange={(v) => {
                  if (v.value) {
                    setLatencyPercentile(v.value);
                  }
                }}
                width={10}
              />
            }
          />
          {hasBreakdown && (
            <BreakdownStatPanel
              title={`Avg TTFT (${latencyPercentile.toUpperCase()})`}
              data={ttftStat.data}
              loading={ttftStat.loading}
              error={ttftStat.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
              unit="s"
              aggregation="avg"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    gridWrapper: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    grid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
      flex: 1,
      minWidth: 0,
    }),
    statsRow: css({
      display: 'flex',
      gap: theme.spacing(4),
      padding: theme.spacing(1.5, 0),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      flexWrap: 'wrap',
    }),
    panelRowFull: css({
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1),
    }),
    panelRowWithStat: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
  };
}
