import React, { useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type ModelResolvePair,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import { StatItem, extractResolvePairs, BreakdownStatPanel } from './dashboardShared';
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
import { PageInsightBar } from '../insight/PageInsightBar';
import { summarizeVector, summarizeMatrix, hasResponseData } from '../insight/summarize';

export type DashboardConsumptionGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
  onTimeRangeChange: (timeRange: TimeRange) => void;
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
  onTimeRangeChange,
}: DashboardConsumptionGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

  const handlePanelTimeRangeChange = useCallback(
    (abs: AbsoluteTimeRange) => {
      const f = dateTime(abs.from);
      const t = dateTime(abs.to);
      onTimeRangeChange({ from: f, to: t, raw: { from: f.toISOString(), to: t.toISOString() } });
    },
    [onTimeRangeChange]
  );

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
    resolvedPricing.loading;

  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const hasAnyData =
      hasResponseData(tokensTotalStat.data) ||
      hasResponseData(tokensByTypeStat.data) ||
      hasResponseData(tokensByTypeTimeseries.data) ||
      hasResponseData(costTokensData.data);
    if (!hasAnyData) {
      return null;
    }
    return [
      'Consumption dashboard context:',
      `Breakdown: ${breakdownBy}`,
      '',
      `Total tokens: ${totalTokensValue}`,
      `Input tokens: ${inputTokensValue}`,
      `Output tokens: ${outputTokensValue}`,
      `Cache read tokens: ${cacheReadValue}`,
      `Cache hit rate: ${cacheHitRate.toFixed(2)}%`,
      `Estimated total cost (USD): $${totalCost.totalCost.toFixed(4)}`,
      '',
      summarizeVector(tokensByTypeStat.data, 'Tokens by type'),
      summarizeMatrix(tokensByTypeTimeseries.data, 'Tokens by type over time'),
      summarizeMatrix(tokensTotalTimeseries.data, 'Total tokens over time'),
      summarizeVector(tokensByBreakdown.data, `Tokens by ${breakdownBy}`),
      summarizeVector(costTokensData.data, 'Token usage by model for cost'),
    ].join('\n');
  }, [
    allDataLoading,
    breakdownBy,
    totalTokensValue,
    inputTokensValue,
    outputTokensValue,
    cacheReadValue,
    cacheHitRate,
    totalCost.totalCost,
    tokensTotalStat.data,
    tokensByTypeStat.data,
    tokensByTypeTimeseries.data,
    tokensTotalTimeseries.data,
    tokensByBreakdown.data,
    costTokensData.data,
  ]);

  const insightPrompt = `Analyze this GenAI consumption dashboard. Breakdown: ${breakdownBy}. Only flag significant findings — cost anomalies, token usage imbalances, cache optimization opportunities, or actionable issues. Skip anything that looks normal.`;

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <div className={styles.statsRow}>
        <StatItem label="Total Tokens" value={totalTokensValue} unit="short" loading={tokensTotalStat.loading} />
        <StatItem label="Input Tokens" value={inputTokensValue} unit="short" loading={inputTokensStat.loading} />
        <StatItem label="Output Tokens" value={outputTokensValue} unit="short" loading={outputTokensStat.loading} />
        <StatItem label="Cache Read" value={cacheReadValue} unit="short" loading={cacheReadTokensStat.loading} />
        <StatItem
          label="Cache Hit Rate"
          value={cacheHitRate}
          unit="percent"
          loading={cacheReadTokensStat.loading || inputTokensStat.loading}
        />
        <StatItem
          label="Estimated Cost"
          value={totalCost.totalCost}
          unit="currencyUSD"
          loading={costTokensData.loading || resolvedPricing.loading}
        />
      </div>
      <PageInsightBar
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-consumption-insight"
        dataContext={insightDataContext}
        systemPrompt="You are a concise observability analyst. Return exactly 3-5 high-confidence suggestions. Include only suggestions strongly supported by the provided data; omit uncertain ideas. Each suggestion is a single short sentence on its own line prefixed with '- '. Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only."
      />

      <div className={styles.grid}>
        {/* Row 1: Tokens by type over time + Tokens by type breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Tokens by type over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
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
            onChangeTimeRange={handlePanelTimeRangeChange}
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
            onChangeTimeRange={handlePanelTimeRangeChange}
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
    statsRow: css({
      display: 'flex',
      gap: theme.spacing(4),
      padding: theme.spacing(1.5, 0),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      flexWrap: 'wrap',
    }),
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
  };
}
