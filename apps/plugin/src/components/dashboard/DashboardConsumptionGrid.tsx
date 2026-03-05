import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { ThresholdsMode, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type ModelResolvePair,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import { extractResolvePairs, BreakdownStatPanel } from './dashboardShared';
import { calculateTotalCost, calculateTotalCostByGroup, calculateCostTimeSeries } from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalTokensQuery,
  totalTokensOverTimeQuery,
  tokensByTypeQuery,
  tokensByTypeOverTimeQuery,
  tokensByModelAndTypeQuery,
  tokensByModelAndTypeOverTimeQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';
import AssistantInsightsBanner from '../assistant/AssistantInsightsBanner';
import { DashboardStatsBar } from './DashboardStatsBar';

export type DashboardConsumptionGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
};

const CHART_HEIGHT = 320;

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardConsumptionGrid({
  dataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
}: DashboardConsumptionGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  // --- Top stats (always aggregate, no breakdown) ---
  const tokensTotalStat = usePrometheusQuery(dataSource, totalTokensQuery(filters, rangeDuration), from, to, 'instant');
  const inputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['input']),
    from,
    to,
    'instant'
  );
  const outputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['output']),
    from,
    to,
    'instant'
  );
  const cacheReadTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_read']),
    from,
    to,
    'instant'
  );

  // --- Cost calculation ---
  const costTokensData = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );
  const costOverTimeData = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  const resolvePairs = useMemo(() => {
    const pairs: ModelResolvePair[] = [];
    if (costTokensData.data) {
      pairs.push(...extractResolvePairs(costTokensData.data));
    }
    if (costOverTimeData.data) {
      pairs.push(...extractResolvePairs(costOverTimeData.data));
    }
    return pairs;
  }, [costTokensData.data, costOverTimeData.data]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  const totalCost = useMemo(() => {
    return calculateTotalCost(costTokensData.data ?? undefined, resolvedPricing.pricingMap);
  }, [costTokensData.data, resolvedPricing.pricingMap]);

  // --- Tokens by type (instant breakdown for pie) ---
  const tokensByTypeStat = usePrometheusQuery(
    dataSource,
    tokensByTypeQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );

  // --- Tokens by type over time ---
  const tokensByTypeTimeseries = usePrometheusQuery(
    dataSource,
    tokensByTypeOverTimeQuery(filters, interval, undefined, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Total tokens over time (with breakdown) ---
  const tokensTotalTimeseries = usePrometheusQuery(
    dataSource,
    totalTokensOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Tokens by breakdown dimension ---
  const tokensByBreakdown = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  // --- Cost by breakdown ---
  const costGroupByLabel = breakdownPromLabel;
  const costByBreakdownData = useMemo<PrometheusQueryResponse | null>(() => {
    if (!costTokensData.data) {
      return null;
    }
    if (!costGroupByLabel) {
      return {
        status: 'success',
        data: {
          resultType: 'vector' as const,
          result: [{ metric: {}, value: [0, String(totalCost.totalCost)] as [number, string] }],
        },
      };
    }
    const groups = calculateTotalCostByGroup(
      costTokensData.data ?? undefined,
      resolvedPricing.pricingMap,
      costGroupByLabel
    );
    return {
      status: 'success',
      data: {
        resultType: 'vector' as const,
        result: groups.map((g) => ({
          metric: { [costGroupByLabel]: g.label },
          value: [0, String(g.cost)] as [number, string],
        })),
      },
    };
  }, [costGroupByLabel, costTokensData.data, resolvedPricing.pricingMap, totalCost.totalCost]);

  const costTimeSeries = useMemo(() => {
    if (!costOverTimeData.data) {
      return [];
    }
    return calculateCostTimeSeries(costOverTimeData.data ?? undefined, resolvedPricing.pricingMap, costGroupByLabel);
  }, [costOverTimeData.data, resolvedPricing.pricingMap, costGroupByLabel]);

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const consumptionOptions = {
    legend: { displayMode: 'table', placement: 'right', calcs: ['mean'], maxWidth: 280 },
    tooltip: tooltipOptions,
  };

  const totalTokensValue = tokensTotalStat.data ? vectorToStatValue(tokensTotalStat.data) : 0;
  const inputTokensValue = inputTokensStat.data ? vectorToStatValue(inputTokensStat.data) : 0;
  const outputTokensValue = outputTokensStat.data ? vectorToStatValue(outputTokensStat.data) : 0;
  const cacheReadValue = cacheReadTokensStat.data ? vectorToStatValue(cacheReadTokensStat.data) : 0;
  const cacheHitRate =
    inputTokensValue + cacheReadValue > 0 ? (cacheReadValue / (inputTokensValue + cacheReadValue)) * 100 : 0;
  const allDataLoading =
    tokensTotalStat.loading ||
    inputTokensStat.loading ||
    outputTokensStat.loading ||
    cacheReadTokensStat.loading ||
    costTokensData.loading ||
    costOverTimeData.loading ||
    resolvedPricing.loading ||
    tokensByTypeStat.loading ||
    tokensByTypeTimeseries.loading ||
    tokensTotalTimeseries.loading ||
    tokensByBreakdown.loading;
  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const hasAnyData =
      hasResponseData(tokensTotalStat.data) ||
      hasResponseData(inputTokensStat.data) ||
      hasResponseData(outputTokensStat.data) ||
      hasResponseData(cacheReadTokensStat.data) ||
      hasResponseData(tokensByTypeStat.data) ||
      hasResponseData(tokensByTypeTimeseries.data) ||
      hasResponseData(tokensTotalTimeseries.data) ||
      hasResponseData(tokensByBreakdown.data) ||
      hasResponseData(costByBreakdownData);
    if (!hasAnyData) {
      return null;
    }
    const parts = [
      'Consumption dashboard context:',
      `Time range (raw): from=${String(timeRange.raw.from)}; to=${String(timeRange.raw.to)}`,
      `Time range (UTC): from=${formatUtcMillis(from)}; to=${formatUtcMillis(to)}`,
      `Breakdown: ${breakdownBy}`,
      '',
      summarizeVector(tokensTotalStat.data, 'Total tokens'),
      summarizeVector(inputTokensStat.data, 'Input tokens'),
      summarizeVector(outputTokensStat.data, 'Output tokens'),
      summarizeVector(cacheReadTokensStat.data, 'Cache read tokens'),
      `Cache hit rate (%): ${cacheHitRate.toFixed(2)}`,
      summarizeVector(tokensByTypeStat.data, 'Tokens by type'),
      summarizeMatrix(tokensByTypeTimeseries.data, 'Tokens by type over time'),
      summarizeMatrix(tokensTotalTimeseries.data, hasBreakdown ? `Tokens over time by ${breakdownBy}` : 'Total tokens over time'),
      summarizeVector(tokensByBreakdown.data, hasBreakdown ? `Tokens by ${breakdownBy}` : 'Tokens'),
      summarizeVector(costByBreakdownData, hasBreakdown ? `Cost by ${breakdownBy}` : 'Estimated cost'),
      summarizeCostTimeSeries(costTimeSeries, hasBreakdown ? `Cost over time by ${breakdownBy}` : 'Estimated cost over time'),
      `Estimated total cost (USD): $${totalCost.totalCost.toFixed(4)}`,
    ];
    return parts.join('\n');
  }, [
    allDataLoading,
    tokensTotalStat.data,
    inputTokensStat.data,
    outputTokensStat.data,
    cacheReadTokensStat.data,
    tokensByTypeStat.data,
    tokensByTypeTimeseries.data,
    tokensTotalTimeseries.data,
    tokensByBreakdown.data,
    costByBreakdownData,
    costTimeSeries,
    totalCost.totalCost,
    timeRange.raw.from,
    timeRange.raw.to,
    from,
    to,
    breakdownBy,
    hasBreakdown,
    cacheHitRate,
  ]);
  const insightPrompt = `Analyze this consumption observability dashboard. Breakdown: ${breakdownBy}. Only flag significant findings — anomalies, outliers, unusual token mix, or actionable cost issues. Skip anything that looks normal.`;

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <DashboardStatsBar
        stats={[
          { label: 'Total Tokens', value: totalTokensValue, unit: 'short', loading: tokensTotalStat.loading },
          { label: 'Input Tokens', value: inputTokensValue, unit: 'short', loading: inputTokensStat.loading },
          { label: 'Output Tokens', value: outputTokensValue, unit: 'short', loading: outputTokensStat.loading },
          { label: 'Cache Read', value: cacheReadValue, unit: 'short', loading: cacheReadTokensStat.loading },
          {
            label: 'Cache Hit Rate',
            value: cacheHitRate,
            unit: 'percent',
            loading: cacheReadTokensStat.loading || inputTokensStat.loading,
          },
          {
            label: 'Estimated Cost',
            value: totalCost.totalCost,
            unit: 'currencyUSD',
            loading: costTokensData.loading || resolvedPricing.loading,
            invertChange: true,
          },
        ]}
      />
      <AssistantInsightsBanner
        className={styles.insightBanner}
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-consumption-insight"
        systemPrompt="You are a concise observability analyst. Return 3-5 plain text insights. Each insight must be one short sentence on its own line, prefixed with '- '. No markdown, no headers, no extra text. Focus only on anomalies, changes, or notable patterns that are strongly supported by the provided data."
        dataContext={insightDataContext}
      />
      <div className={styles.grid}>
        {/* Row 1: Tokens by type over time + Tokens by type breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Tokens by type over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={tokensByTypeTimeseries.loading}
            error={tokensByTypeTimeseries.error}
            data={tokensByTypeTimeseries.data ? matrixToDataFrames(tokensByTypeTimeseries.data) : []}
            options={consumptionOptions}
            fieldConfig={{
              defaults: {
                unit: 'short',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title="Tokens by type"
            data={tokensByTypeStat.data}
            loading={tokensByTypeStat.loading}
            error={tokensByTypeStat.error}
            breakdownLabel="gen_ai_token_type"
            height={CHART_HEIGHT}
          />
        </div>

        {/* Row 2: Total tokens over time (by breakdown) + Tokens by breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Tokens over time by ${breakdownBy}` : 'Total tokens over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={tokensTotalTimeseries.loading}
            error={tokensTotalTimeseries.error}
            data={tokensTotalTimeseries.data ? matrixToDataFrames(tokensTotalTimeseries.data) : []}
            options={consumptionOptions}
            fieldConfig={{
              defaults: {
                unit: 'short',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          {hasBreakdown ? (
            <BreakdownStatPanel
              title={`Tokens by ${breakdownBy}`}
              data={tokensByBreakdown.data}
              loading={tokensByBreakdown.loading}
              error={tokensByBreakdown.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
            />
          ) : (
            <BreakdownStatPanel
              title="Total Tokens"
              data={tokensTotalStat.data}
              loading={tokensTotalStat.loading}
              error={tokensTotalStat.error}
              height={CHART_HEIGHT}
            />
          )}
        </div>

        {/* Row 4: Estimated cost over time + Estimated Cost stat */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Cost over time by ${breakdownBy}` : 'Estimated cost over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={costOverTimeData.loading || resolvedPricing.loading}
            error={costOverTimeData.error}
            data={costTimeSeries}
            options={consumptionOptions}
            fieldConfig={{
              defaults: {
                unit: 'currencyUSD',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title={hasBreakdown ? `Cost by ${breakdownBy}` : 'Estimated Cost'}
            data={costByBreakdownData}
            loading={costTokensData.loading || resolvedPricing.loading}
            error={costTokensData.error}
            breakdownLabel={costGroupByLabel}
            height={CHART_HEIGHT}
            unit="currencyUSD"
          />
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
    }),
    insightBanner: css({
      width: '100%',
    }),
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
  };
}

function hasResponseData(response: PrometheusQueryResponse | null | undefined): boolean {
  if (!response) {
    return false;
  }
  if (response.data.resultType !== 'vector' && response.data.resultType !== 'matrix') {
    return false;
  }
  return response.data.result.length > 0;
}

function summarizeVector(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'vector') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
  if (results.length === 0) {
    return `${label}: 0`;
  }
  if (results.length === 1) {
    return `${label}: ${results[0].value[1]}`;
  }
  const lines = results.map((r) => {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `  ${tags || 'total'}: ${r.value[1]}`;
  });
  return `${label} (by series):\n${lines.join('\n')}`;
}

function summarizeMatrix(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'matrix') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  if (results.length === 0) {
    return `${label}: no series`;
  }
  const lines = results.map((r) => {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const vals = r.values;
    const last = vals.length > 0 ? vals[vals.length - 1][1] : 'N/A';
    const first = vals.length > 0 ? vals[0][1] : 'N/A';
    return `  ${tags || 'total'}: first=${first}, last=${last}, points=${vals.length}`;
  });
  return `${label} (${results.length} series):\n${lines.join('\n')}`;
}

function summarizeCostTimeSeries(series: any[], label: string): string {
  if (series.length === 0) {
    return `${label}: no data`;
  }
  const lines = series.map((frame) => {
    const valueField = frame.fields[1];
    const values = valueField?.values;
    const points = values && typeof values.length === 'number' ? values.length : 0;
    const first = points > 0 ? String(values?.get(0) ?? 'N/A') : 'N/A';
    const last = points > 0 ? String(values?.get(points - 1) ?? 'N/A') : 'N/A';
    return `  ${frame.name || 'series'}: first=${first}, last=${last}, points=${points}`;
  });
  return `${label} (${series.length} series):\n${lines.join('\n')}`;
}

function formatUtcMillis(ms: number): string {
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) {
    return 'invalid';
  }
  return dt.toISOString();
}
