import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  ThresholdsMode,
  getValueFormat,
  formattedValueToString,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import { Button, Icon, IconButton, Select, Spinner, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import { useInlineAssistant } from '@grafana/assistant';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type CostMode,
  type DashboardFilters,
  type LatencyPercentile,
  type ModelResolvePair,
  type PrometheusQueryResponse,
  type TokenDrilldown,
  breakdownToPromLabel,
  tokenDrilldownTypes,
} from '../../dashboard/types';
import { calculateTotalCost, calculateTotalCostByGroup, calculateCostTimeSeries } from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalOpsQuery,
  errorRateQuery,
  latencyStatQuery,
  tokensByModelAndTypeQuery,
  totalTokensQuery,
  totalTokensOverTimeQuery,
  tokensByTypeQuery,
  tokensByBreakdownAndTypeQuery,
  tokensByTypeOverTimeQuery,
  requestsSuccessOverTimeQuery,
  requestsErrorOverTimeQuery,
  requestsOverTimeQuery,
  errorRateOverTimeQuery,
  latencyOverTimeQuery,
  ttftOverTimeQuery,
  tokensByModelAndTypeOverTimeQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';

export type DashboardGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
};

const CHART_HEIGHT = 320;

const costModeOptions: Array<{ label: string; value: CostMode }> = [
  { label: 'Cost', value: 'usd' },
  { label: 'Tokens', value: 'tokens' },
];

const latencyPercentileOptions: Array<{ label: string; value: LatencyPercentile }> = [
  { label: 'P50', value: 'p50' },
  { label: 'P95', value: 'p95' },
  { label: 'P99', value: 'p99' },
];

const tokenDrilldownOptions: Array<{ label: string; value: TokenDrilldown }> = [
  { label: 'Total', value: 'all' },
  { label: 'Input / Output', value: 'io' },
  { label: 'Cache', value: 'cache' },
];

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardGrid({ dataSource, filters, breakdownBy, from, to, timeRange }: DashboardGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const [latencyPercentile, setLatencyPercentile] = useState<LatencyPercentile>('p95');
  const [costMode, setCostMode] = useState<CostMode>('tokens');
  const [tokenDrilldown, setTokenDrilldown] = useState<TokenDrilldown>('all');

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  const latencyQuantileMap: Record<LatencyPercentile, number> = { p50: 0.5, p95: 0.95, p99: 0.99 };

  // --- Top stats (always aggregate, no breakdown) ---
  const topTotalOps = usePrometheusQuery(dataSource, totalOpsQuery(filters, rangeDuration), from, to, 'instant');
  const topErrRate = usePrometheusQuery(dataSource, errorRateQuery(filters, rangeDuration), from, to, 'instant');
  const topLatency = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );

  // --- Total requests stat (with breakdown for pie) ---
  const totalOpsStat = usePrometheusQuery(
    dataSource,
    totalOpsQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  // --- Previous period comparison (same queries shifted back 1 hour) ---
  const hourAgo = 3600;
  const prevFrom = from - hourAgo;
  const prevTo = to - hourAgo;
  const prevTotalOps = usePrometheusQuery(
    dataSource,
    totalOpsQuery(filters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevErrRate = usePrometheusQuery(
    dataSource,
    errorRateQuery(filters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevLatency = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevTokensTotal = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevCostTokens = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, 'none'),
    prevFrom,
    prevTo,
    'instant'
  );
  const costTokens = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  // --- Requests over time ---
  const requestsSuccess = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : requestsSuccessOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const requestsError = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : requestsErrorOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const requestsBroken = usePrometheusQuery(
    dataSource,
    hasBreakdown ? requestsOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Error rate over time ---
  const errorsTimeseries = usePrometheusQuery(
    dataSource,
    errorRateOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Latency over time ---
  const latencyQuery = latencyOverTimeQuery(filters, interval, breakdownBy, latencyQuantileMap[latencyPercentile]);
  const latencyTimeseries = usePrometheusQuery(dataSource, latencyQuery, from, to, 'range', step);

  // --- Latency stat (with breakdown for panel) ---
  const latencyStat = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, breakdownBy, latencyQuantileMap[latencyPercentile]),
    from,
    to,
    'instant'
  );

  // --- TTFT over time ---
  const ttftTimeseries = usePrometheusQuery(
    dataSource,
    ttftOverTimeQuery(filters, interval, breakdownBy, latencyQuantileMap[latencyPercentile]),
    from,
    to,
    'range',
    step
  );

  // --- Cost over time (with breakdown support) ---
  const costOverTime = usePrometheusQuery(
    dataSource,
    costMode === 'usd' ? tokensByModelAndTypeOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Token drilldown queries ---
  const drilldownTypes = tokenDrilldownTypes[tokenDrilldown];
  const isTokenTotal = costMode === 'tokens' && tokenDrilldown === 'all';
  const isTokenByType = costMode === 'tokens' && tokenDrilldown !== 'all';

  const tokensTotalStat = usePrometheusQuery(dataSource, totalTokensQuery(filters, rangeDuration), from, to, 'instant');
  const tokensTotalByBreakdown = usePrometheusQuery(
    dataSource,
    costMode === 'tokens' ? totalTokensQuery(filters, rangeDuration, breakdownBy) : '',
    from,
    to,
    'instant'
  );
  const tokensTotalTimeseries = usePrometheusQuery(
    dataSource,
    isTokenTotal ? totalTokensOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );
  const tokensByTypeStat = usePrometheusQuery(
    dataSource,
    isTokenByType && !hasBreakdown ? tokensByTypeQuery(filters, rangeDuration, drilldownTypes) : '',
    from,
    to,
    'instant'
  );
  const tokensByBreakdownStat = usePrometheusQuery(
    dataSource,
    isTokenByType && hasBreakdown ? totalTokensQuery(filters, rangeDuration, breakdownBy, drilldownTypes) : '',
    from,
    to,
    'instant'
  );
  const tokensByTypeTimeseries = usePrometheusQuery(
    dataSource,
    isTokenByType ? tokensByTypeOverTimeQuery(filters, interval, drilldownTypes, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );
  const tokensByBreakdownAndType = usePrometheusQuery(
    dataSource,
    isTokenByType && hasBreakdown
      ? tokensByBreakdownAndTypeQuery(filters, rangeDuration, breakdownBy, drilldownTypes)
      : '',
    from,
    to,
    'instant'
  );

  // --- Computed cost ---
  const costTokensData = costTokens.data ?? undefined;
  const costOverTimeData = costOverTime.data ?? undefined;

  const resolvePairs = useMemo(() => {
    const pairs: ModelResolvePair[] = [];
    pairs.push(...extractResolvePairs(costTokensData));
    pairs.push(...extractResolvePairs(costOverTimeData));
    return pairs;
  }, [costTokensData, costOverTimeData]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  const totalCost = useMemo(() => {
    return calculateTotalCost(costTokensData, resolvedPricing.pricingMap);
  }, [costTokensData, resolvedPricing.pricingMap]);

  const prevCostTokensData = prevCostTokens.data ?? undefined;
  const prevTotalCost = useMemo(() => {
    return calculateTotalCost(prevCostTokensData, resolvedPricing.pricingMap);
  }, [prevCostTokensData, resolvedPricing.pricingMap]);

  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;
  const costGroupByLabel = breakdownPromLabel;

  const costByBreakdownData = useMemo<PrometheusQueryResponse | null>(() => {
    if (costMode !== 'usd' || !costTokensData) {
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
    const groups = calculateTotalCostByGroup(costTokensData, resolvedPricing.pricingMap, costGroupByLabel);
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
  }, [costMode, costGroupByLabel, costTokensData, resolvedPricing.pricingMap, totalCost.totalCost]);

  const costTimeSeries = useMemo(() => {
    if (isTokenTotal) {
      return tokensTotalTimeseries.data ? matrixToDataFrames(tokensTotalTimeseries.data) : [];
    }
    if (isTokenByType) {
      return tokensByTypeTimeseries.data ? matrixToDataFrames(tokensByTypeTimeseries.data) : [];
    }
    if (!costOverTimeData) {
      return [];
    }
    return calculateCostTimeSeries(costOverTimeData, resolvedPricing.pricingMap, costGroupByLabel);
  }, [
    isTokenTotal,
    isTokenByType,
    costOverTimeData,
    resolvedPricing.pricingMap,
    costGroupByLabel,
    tokensTotalTimeseries.data,
    tokensByTypeTimeseries.data,
  ]);

  const costLoading = isTokenTotal
    ? tokensTotalStat.loading
    : isTokenByType
      ? hasBreakdown
        ? tokensByBreakdownStat.loading
        : tokensByTypeStat.loading
      : costTokens.loading || resolvedPricing.loading;
  const costSeriesLoading = isTokenTotal
    ? tokensTotalTimeseries.loading
    : isTokenByType
      ? tokensByTypeTimeseries.loading
      : costOverTime.loading || resolvedPricing.loading;

  // --- Build request chart data ---
  const requestsData = useMemo(() => {
    if (hasBreakdown) {
      return requestsBroken.data ? matrixToDataFrames(requestsBroken.data) : [];
    }
    const frames = [];
    if (requestsSuccess.data) {
      const successFrames = matrixToDataFrames(requestsSuccess.data);
      for (const f of successFrames) {
        f.name = 'Success';
        if (f.fields[1]) {
          f.fields[1].config = { ...f.fields[1].config, displayName: 'Success' };
        }
      }
      frames.push(...successFrames);
    }
    if (requestsError.data) {
      const errorFrames = matrixToDataFrames(requestsError.data);
      for (const f of errorFrames) {
        f.name = 'Errors';
        if (f.fields[1]) {
          f.fields[1].config = { ...f.fields[1].config, displayName: 'Errors' };
        }
      }
      frames.push(...errorFrames);
    }
    return frames;
  }, [hasBreakdown, requestsBroken.data, requestsSuccess.data, requestsError.data]);

  const requestsLoading = hasBreakdown ? requestsBroken.loading : requestsSuccess.loading || requestsError.loading;
  const requestsErr = hasBreakdown ? requestsBroken.error : requestsSuccess.error || requestsError.error;

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const requestsOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };
  const errorOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };
  const latencyOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };
  const consumptionOptions = {
    legend: { displayMode: 'table', placement: 'right', calcs: ['mean'], maxWidth: 280 },
    tooltip: tooltipOptions,
  };

  const allDataLoading =
    topTotalOps.loading ||
    topErrRate.loading ||
    requestsLoading ||
    errorsTimeseries.loading ||
    topLatency.loading ||
    latencyTimeseries.loading ||
    costLoading ||
    costSeriesLoading ||
    tokensByTypeStat.loading ||
    tokensByTypeTimeseries.loading;
  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const requestsSource = hasBreakdown ? requestsBroken.data : requestsSuccess.data;
    const hasAnyData =
      hasResponseData(topTotalOps.data) ||
      hasResponseData(requestsSource) ||
      hasResponseData(topLatency.data) ||
      hasResponseData(latencyTimeseries.data);
    if (!hasAnyData) {
      return null;
    }
    const parts = [
      summarizeVector(topTotalOps.data, 'Total Requests'),
      summarizeVector(topErrRate.data, 'Error Rate (%)'),
      summarizeMatrix(requestsSource, 'Requests over time'),
      summarizeMatrix(errorsTimeseries.data, 'Errors over time'),
      summarizeVector(topLatency.data, `Latency ${latencyPercentile} (seconds)`),
      summarizeMatrix(latencyTimeseries.data, 'Latency over time'),
    ];
    if (costMode === 'tokens' && tokenDrilldown === 'all') {
      parts.push(summarizeVector(tokensTotalStat.data, 'Total tokens'));
      parts.push(summarizeVector(tokensTotalByBreakdown.data, 'Total tokens by breakdown'));
      parts.push(summarizeMatrix(tokensTotalTimeseries.data, 'Total tokens over time'));
    } else if (costMode === 'tokens') {
      parts.push(summarizeVector(tokensByTypeStat.data, 'Tokens by type'));
      parts.push(summarizeMatrix(tokensByTypeTimeseries.data, 'Tokens over time'));
    } else {
      parts.push(`Estimated total cost (USD): $${totalCost.totalCost.toFixed(4)}`);
      parts.push(summarizeVector(costTokens.data, 'Token usage by model'));
    }
    return parts.join('\n');
  }, [
    allDataLoading,
    topTotalOps.data,
    topErrRate.data,
    hasBreakdown,
    requestsBroken.data,
    requestsSuccess.data,
    errorsTimeseries.data,
    topLatency.data,
    latencyPercentile,
    latencyTimeseries.data,
    costMode,
    tokenDrilldown,
    tokensTotalStat.data,
    tokensTotalByBreakdown.data,
    tokensTotalTimeseries.data,
    tokensByTypeStat.data,
    tokensByTypeTimeseries.data,
    totalCost.totalCost,
    costTokens.data,
  ]);

  const insightPrompt = `Analyze this GenAI observability dashboard. Breakdown: ${breakdownBy}. Latency percentile: ${latencyPercentile}. Cost mode: ${costMode}${costMode === 'tokens' ? `. Token drilldown: ${tokenDrilldown}` : ''}. Only flag significant findings — anomalies, outliers, or actionable issues. Skip anything that looks normal.`;

  const totalRequestsValue = topTotalOps.data ? vectorToStatValue(topTotalOps.data) : 0;
  const latencyValue = topLatency.data ? vectorToStatValue(topLatency.data) : 0;
  const errorRateValue = topErrRate.data ? vectorToStatValue(topErrRate.data) : 0;
  const totalTokensValue = tokensTotalStat.data ? vectorToStatValue(tokensTotalStat.data) : 0;

  const prevRequestsValue = prevTotalOps.data ? vectorToStatValue(prevTotalOps.data) : 0;
  const prevLatencyValue = prevLatency.data ? vectorToStatValue(prevLatency.data) : 0;
  const prevErrRateValue = prevErrRate.data ? vectorToStatValue(prevErrRate.data) : 0;
  const prevTokensValue = prevTokensTotal.data ? vectorToStatValue(prevTokensTotal.data) : 0;

  return (
    <div className={styles.gridWrapper}>
      {/* Top-level stats row */}
      <div className={styles.statsRow}>
        <TopStat
          label="Total Requests"
          value={totalRequestsValue}
          loading={topTotalOps.loading}
          prevValue={prevRequestsValue}
          prevLoading={prevTotalOps.loading}
          styles={styles}
        />
        <TopStat
          label="Avg Latency (P95)"
          value={latencyValue}
          unit="s"
          loading={topLatency.loading}
          prevValue={prevLatencyValue}
          prevLoading={prevLatency.loading}
          invertChange
          styles={styles}
        />
        <TopStat
          label="Error Rate"
          value={errorRateValue}
          unit="percent"
          loading={topErrRate.loading}
          prevValue={prevErrRateValue}
          prevLoading={prevErrRate.loading}
          invertChange
          styles={styles}
        />
        <TopStat
          label="Total Tokens"
          value={totalTokensValue}
          unit="short"
          loading={tokensTotalStat.loading}
          prevValue={prevTokensValue}
          prevLoading={prevTokensTotal.loading}
          styles={styles}
        />
        <TopStat
          label="Total Cost"
          value={totalCost.totalCost}
          unit="currencyUSD"
          loading={costTokens.loading || resolvedPricing.loading}
          prevValue={prevTotalCost.totalCost}
          prevLoading={prevCostTokens.loading}
          invertChange
          styles={styles}
        />
      </div>

      <div className={styles.gridOuter}>
        <div className={styles.grid}>
          {/* Row 1: Requests & Errors */}
          <div className={styles.panelRowFirstStat}>
            <BreakdownStatPanel
              title="Total Requests"
              data={totalOpsStat.data}
              loading={totalOpsStat.loading}
              error={totalOpsStat.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
            />
            <MetricPanel
              title="Requests/s"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={requestsLoading}
              error={requestsErr}
              data={requestsData}
              options={requestsOptions}
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
            <MetricPanel
              title="Error rate"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={errorsTimeseries.loading}
              error={errorsTimeseries.error}
              data={errorsTimeseries.data ? matrixToDataFrames(errorsTimeseries.data) : []}
              options={errorOptions}
              fieldConfig={{
                defaults: {
                  unit: 'percent',
                  color: consistentColor,
                  custom: timeseriesDefaults,
                  thresholds: noThresholds,
                },
                overrides: [],
              }}
            />
          </div>

          {/* Row 2: Latency */}
          <div className={styles.panelRowLatencyFull}>
            <MetricPanel
              title="Latency"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={latencyTimeseries.loading}
              error={latencyTimeseries.error}
              data={latencyTimeseries.data ? matrixToDataFrames(latencyTimeseries.data) : []}
              options={latencyOptions}
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
            <MetricPanel
              title="Time to First Token"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={ttftTimeseries.loading}
              error={ttftTimeseries.error}
              data={ttftTimeseries.data ? matrixToDataFrames(ttftTimeseries.data) : []}
              options={latencyOptions}
              fieldConfig={{
                defaults: { unit: 's', color: consistentColor, custom: timeseriesDefaults, thresholds: noThresholds },
                overrides: [],
              }}
            />
          </div>

          {/* Row 3: Consumption */}
          <div className={styles.panelRowLatency}>
            <MetricPanel
              title="Consumption"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={costSeriesLoading}
              error={
                isTokenTotal
                  ? tokensTotalTimeseries.error
                  : isTokenByType
                    ? tokensByTypeTimeseries.error
                    : costOverTime.error
              }
              data={costTimeSeries}
              options={consumptionOptions}
              fieldConfig={{
                defaults: {
                  unit: costMode === 'tokens' ? 'short' : 'currencyUSD',
                  color: consistentColor,
                  custom: timeseriesDefaults,
                  thresholds: noThresholds,
                },
                overrides: [],
              }}
              titleItems={
                <div className={styles.panelActions}>
                  <Select
                    options={costModeOptions}
                    value={costMode}
                    onChange={(v) => {
                      if (v.value) {
                        setCostMode(v.value);
                      }
                    }}
                    width={12}
                  />
                  {costMode === 'tokens' && (
                    <Select
                      options={tokenDrilldownOptions}
                      value={tokenDrilldown}
                      onChange={(v) => {
                        if (v.value) {
                          setTokenDrilldown(v.value);
                        }
                      }}
                      width={18}
                    />
                  )}
                </div>
              }
            />
            <BreakdownStatPanel
              title={costMode === 'tokens' ? 'Total Tokens' : 'Total Cost'}
              data={
                isTokenByType && hasBreakdown
                  ? tokensByBreakdownAndType.data
                  : isTokenByType
                    ? tokensByTypeStat.data
                    : costMode === 'tokens'
                      ? tokensTotalByBreakdown.data
                      : costByBreakdownData
              }
              loading={
                isTokenByType && hasBreakdown
                  ? tokensByBreakdownAndType.loading
                  : isTokenByType
                    ? tokensByTypeStat.loading
                    : costMode === 'tokens'
                      ? tokensTotalByBreakdown.loading
                      : costTokens.loading || resolvedPricing.loading
              }
              error={
                isTokenByType && hasBreakdown
                  ? tokensByBreakdownAndType.error
                  : isTokenByType
                    ? tokensByTypeStat.error
                    : costMode === 'tokens'
                      ? tokensTotalByBreakdown.error
                      : costTokens.error
              }
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
              unit={costMode === 'tokens' ? 'short' : 'currencyUSD'}
              segmentLabel={isTokenByType && hasBreakdown ? 'gen_ai_token_type' : undefined}
              segmentNames={isTokenByType && hasBreakdown ? drilldownTypes : undefined}
            />
          </div>
        </div>

        <InsightPanel prompt={insightPrompt} origin="sigil-plugin/dashboard-insight" dataContext={insightDataContext} />
      </div>
    </div>
  );
}

function formatStatValue(value: number, unit?: string): string {
  if (unit) {
    const fmt = getValueFormat(unit);
    return formattedValueToString(fmt(value));
  }
  const fmt = getValueFormat('short');
  return formattedValueToString(fmt(value));
}

type TopStatProps = {
  label: string;
  value: number;
  unit?: string;
  loading: boolean;
  prevValue?: number;
  prevLoading?: boolean;
  invertChange?: boolean;
  styles: ReturnType<typeof getStyles>;
};

function TopStat({ label, value, unit, loading, prevValue, prevLoading, invertChange, styles }: TopStatProps) {
  let changeBadge: React.ReactNode = null;
  if (!loading && !prevLoading && prevValue !== undefined) {
    if (prevValue === 0 && value === 0) {
      changeBadge = (
        <Tooltip content="Zero one hour ago" placement="bottom">
          <span className={`${styles.changeBadge} ${styles.changeBadgeNeutral}`}>→ 0%</span>
        </Tooltip>
      );
    } else if (prevValue === 0) {
      const isGood = !invertChange;
      const badgeClass = isGood ? styles.changeBadgeGood : styles.changeBadgeWarn;
      changeBadge = (
        <Tooltip content="Zero one hour ago" placement="bottom">
          <span className={`${styles.changeBadge} ${badgeClass}`}>new</span>
        </Tooltip>
      );
    } else {
      const pctChange = ((value - prevValue) / Math.abs(prevValue)) * 100;
      const isUp = pctChange > 0;
      const isGood = invertChange ? !isUp : isUp;
      const arrow = isUp ? '↑' : '↓';
      const sign = isUp ? '+' : '';
      const badgeClass =
        pctChange === 0 ? styles.changeBadgeNeutral : isGood ? styles.changeBadgeGood : styles.changeBadgeWarn;
      const tooltipText = `${formatStatValue(prevValue, unit)} one hour ago`;
      changeBadge = (
        <Tooltip content={tooltipText} placement="bottom">
          <span className={`${styles.changeBadge} ${badgeClass}`}>
            {arrow} {sign}
            {pctChange.toFixed(1)}%
          </span>
        </Tooltip>
      );
    }
  }

  return (
    <div className={styles.topStat}>
      <span className={styles.topStatLabel}>{label}</span>
      <div className={styles.topStatRow}>
        <span className={styles.topStatValue}>{loading ? '–' : formatStatValue(value, unit)}</span>
        {changeBadge}
      </div>
    </div>
  );
}

// Replicates Grafana's palette-classic-by-name: djb2 hash (same as string-hash npm package)
// + WCAG contrast filtering to match the exact subset of colors Grafana uses.
function stringHash(str: string): number {
  let hash = 5381;
  let i = str.length;
  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  return hash >>> 0;
}

function relativeLuminance(hex: string): number {
  const raw = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fg: string, bg: string): number {
  const lumA = relativeLuminance(fg);
  const lumB = relativeLuminance(bg);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

type BreakdownStatPanelProps = {
  title: string;
  data: PrometheusQueryResponse | null | undefined;
  loading: boolean;
  error?: string;
  breakdownLabel?: string;
  height: number;
  unit?: string;
  aggregation?: 'sum' | 'avg';
  segmentLabel?: string;
  segmentNames?: string[];
};

function BreakdownStatPanel({
  title,
  data,
  loading,
  error,
  breakdownLabel,
  height,
  unit = 'short',
  aggregation = 'sum',
  segmentLabel,
  segmentNames,
}: BreakdownStatPanelProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();

  const resolvedPalette = useMemo(() => {
    const bg = theme.colors.background.primary;
    const threshold = theme.colors.contrastThreshold;
    return theme.visualization.palette
      .filter((name) => contrastRatio(theme.visualization.getColorByName(name), bg) >= threshold)
      .map((name) => theme.visualization.getColorByName(name));
  }, [theme]);

  const isStacked = Boolean(segmentLabel && segmentNames && segmentNames.length > 0);

  const items = useMemo(() => {
    if (!data || data.data.resultType !== 'vector') {
      return [];
    }
    const results = data.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
    return results
      .map((r) => {
        const name =
          (breakdownLabel ? r.metric[breakdownLabel] : '') ||
          Object.values(r.metric).filter(Boolean).join(' / ') ||
          'unknown';
        const color = resolvedPalette[stringHash(name) % resolvedPalette.length];
        return { name, value: parseFloat(r.value[1]), color };
      })
      .filter((r) => isFinite(r.value))
      .sort((a, b) => b.value - a.value);
  }, [data, breakdownLabel, resolvedPalette]);

  type StackedItem = {
    name: string;
    total: number;
    color: string;
    segments: Array<{ segName: string; value: number; color: string }>;
  };

  const stackedItems = useMemo((): StackedItem[] => {
    if (!isStacked || !data || data.data.resultType !== 'vector' || !segmentLabel || !segmentNames) {
      return [];
    }
    const results = data.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
    const grouped = new Map<string, Map<string, number>>();
    for (const r of results) {
      const breakdownName = (breakdownLabel ? r.metric[breakdownLabel] : '') || 'unknown';
      const seg = r.metric[segmentLabel] || 'unknown';
      const val = parseFloat(r.value[1]);
      if (!isFinite(val)) {
        continue;
      }
      if (!grouped.has(breakdownName)) {
        grouped.set(breakdownName, new Map());
      }
      grouped.get(breakdownName)!.set(seg, (grouped.get(breakdownName)!.get(seg) ?? 0) + val);
    }

    const segColors = new Map<string, string>();
    for (const seg of segmentNames) {
      segColors.set(seg, resolvedPalette[stringHash(seg) % resolvedPalette.length]);
    }

    return Array.from(grouped.entries())
      .map(([name, segs]) => {
        const total = Array.from(segs.values()).reduce((s, v) => s + v, 0);
        const segments = segmentNames.map((sn) => ({
          segName: sn,
          value: segs.get(sn) ?? 0,
          color: segColors.get(sn) ?? resolvedPalette[0],
        }));
        return { name, total, color: resolvedPalette[stringHash(name) % resolvedPalette.length], segments };
      })
      .sort((a, b) => b.total - a.total);
  }, [isStacked, data, breakdownLabel, segmentLabel, segmentNames, resolvedPalette]);

  const aggregate = useMemo(() => {
    const src = isStacked ? stackedItems.map((i) => i.total) : items.map((i) => i.value);
    if (src.length === 0) {
      return 0;
    }
    const total = src.reduce((s, v) => s + v, 0);
    return aggregation === 'avg' ? total / src.length : total;
  }, [items, stackedItems, isStacked, aggregation]);

  const formatVal = (v: number) => formattedValueToString(getValueFormat(unit)(v));

  if (loading) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter} style={{ opacity: 0.6 }}>
          {error}
        </div>
      </div>
    );
  }

  if (isStacked && stackedItems.length > 0) {
    const maxTotal = stackedItems[0].total;
    const segColors = segmentNames!.map((sn) => ({
      name: sn,
      color: resolvedPalette[stringHash(sn) % resolvedPalette.length],
    }));
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
          <div className={styles.bspValueRow}>
            <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
          </div>
          <div className={styles.bspSegmentLegend}>
            {segColors.map((sc) => (
              <span key={sc.name} className={styles.bspSegmentLegendItem}>
                <span className={styles.bspBarDot} style={{ background: sc.color }} />
                {sc.name}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.bspList}>
          {stackedItems.map((item) => {
            const barWidth = maxTotal > 0 ? (item.total / maxTotal) * 100 : 0;
            return (
              <div key={item.name} className={styles.bspBarRow}>
                <div className={styles.bspBarMeta}>
                  <span className={styles.bspBarName}>{item.name}</span>
                  <span className={styles.bspBarValue}>{formatVal(item.total)}</span>
                </div>
                <div className={styles.bspBarTrack}>
                  <div
                    style={{
                      display: 'flex',
                      width: `${barWidth}%`,
                      height: '100%',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    {item.segments.map((seg) => {
                      const segPct = item.total > 0 ? (seg.value / item.total) * 100 : 0;
                      if (segPct === 0) {
                        return null;
                      }
                      return (
                        <Tooltip key={seg.segName} content={`${seg.segName}: ${formatVal(seg.value)}`}>
                          <div style={{ width: `${segPct}%`, height: '100%', background: seg.color, minWidth: 2 }} />
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter}>
          <span className={styles.bspBigValue}>{formatVal(0)}</span>
        </div>
      </div>
    );
  }

  if (items.length === 1) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter}>
          <div style={{ textAlign: 'center' }}>
            <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
            <div className={styles.bspSingleLabel}>{items[0].name}</div>
          </div>
        </div>
      </div>
    );
  }

  const maxValue = items[0].value;
  return (
    <div className={styles.bspPanel} style={{ height }}>
      <div className={styles.bspHeader}>
        <span className={styles.bspTitle}>{title}</span>
        <div className={styles.bspValueRow}>
          <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
        </div>
      </div>
      <div className={styles.bspList}>
        {items.map((item) => {
          const barWidth = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
          return (
            <div key={item.name} className={styles.bspBarRow}>
              <div className={styles.bspBarMeta}>
                <span className={styles.bspBarDot} style={{ background: item.color }} />
                <span className={styles.bspBarName}>{item.name}</span>
                <span className={styles.bspBarValue}>{formatVal(item.value)}</span>
              </div>
              <div className={styles.bspBarTrack}>
                <div className={styles.bspBarFill} style={{ width: `${barWidth}%`, background: item.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatInlineMarkup(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<code key={match.index}>{match[2]}</code>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

type InsightPanelProps = {
  prompt: string;
  origin: string;
  dataContext: string | null;
};

function InsightPanel({ prompt, origin, dataContext }: InsightPanelProps) {
  const styles = useStyles2(getStyles);
  const gen = useInlineAssistant();
  const [text, setText] = useState('');
  const isDevelopment = process.env.NODE_ENV === 'development';
  const hasAutoRun = useRef(isDevelopment);

  const latestRef = useRef({ prompt, origin, dataContext, gen });
  useEffect(() => {
    latestRef.current = { prompt, origin, dataContext, gen };
  });

  const runGenerate = useCallback((ctx: string) => {
    const { prompt: p, origin: o, gen: g } = latestRef.current;
    const fullPrompt = `${p}\n\nDashboard data:\n${ctx}`;
    g.generate({
      prompt: fullPrompt,
      origin: o,
      systemPrompt:
        'You are a concise observability analyst. Return exactly 2-3 findings. Each finding is a single short sentence on its own line prefixed with "- ". Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only.',
      onComplete: (result: string) => setText(result),
      onError: (err: Error) => console.error('Insight generation failed:', err),
    });
  }, []);

  useEffect(() => {
    if (!dataContext || hasAutoRun.current) {
      return;
    }
    hasAutoRun.current = true;
    runGenerate(dataContext);
  }, [dataContext, runGenerate]);

  const doGenerate = useCallback(() => {
    const { dataContext: ctx, gen: g } = latestRef.current;
    if (ctx && !g.isGenerating) {
      setText('');
      runGenerate(ctx);
    }
  }, [runGenerate]);

  const displayText = gen.isGenerating ? gen.content : text;
  const initialWaiting = !dataContext && !text && !gen.isGenerating;
  const hasResult = Boolean(text) || gen.isGenerating;
  const showRegenerate = !gen.isGenerating && hasResult;

  const renderedBullets = useMemo(() => {
    if (!displayText) {
      return null;
    }
    const lines = displayText.split('\n').filter((l) => l.trim().length > 0);
    return (
      <ul>
        {lines.map((line, i) => {
          const content = line.replace(/^[-•*]\s*/, '');
          return (
            <li key={i}>
              <span className="insight-bullet">{formatInlineMarkup(content)}</span>
            </li>
          );
        })}
      </ul>
    );
  }, [displayText]);

  return (
    <div className={styles.insightPanel}>
      <div className={styles.insightPanelHeader}>
        <span className={styles.insightTitle}>
          <Icon name="ai" size="md" />
          Assistant Insight
        </span>
        <div className={styles.insightActions}>
          {(gen.isGenerating || initialWaiting) && <Spinner size="sm" />}
          {showRegenerate && (
            <IconButton name="repeat" aria-label="Rerun insight" tooltip="Rerun" size="md" onClick={doGenerate} />
          )}
        </div>
      </div>
      <div className={styles.insightPanelBody}>
        {initialWaiting ? (
          <span className={styles.insightPlaceholder}>Waiting for data...</span>
        ) : renderedBullets ? (
          <div>{renderedBullets}</div>
        ) : gen.isGenerating ? (
          <span className={styles.insightPlaceholder}>Generating insight...</span>
        ) : isDevelopment ? (
          <Button icon="ai" size="sm" variant="secondary" fill="outline" onClick={doGenerate} disabled={!dataContext}>
            Generate Insight
          </Button>
        ) : (
          <span className={styles.insightPlaceholder}>Generating insight...</span>
        )}
      </div>
    </div>
  );
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

function extractResolvePairs(response?: PrometheusQueryResponse): ModelResolvePair[] {
  if (!response) {
    return [];
  }
  if (response.data.resultType !== 'vector' && response.data.resultType !== 'matrix') {
    return [];
  }

  const pairs: ModelResolvePair[] = [];
  for (const result of response.data.result) {
    const provider = result.metric.gen_ai_provider_name ?? '';
    const model = result.metric.gen_ai_request_model ?? '';
    if (!provider || !model) {
      continue;
    }
    pairs.push({ provider, model });
  }
  return pairs;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    gridWrapper: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    gridOuter: css({
      display: 'flex',
      gap: theme.spacing(2),
      alignItems: 'stretch',
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
    }),
    topStat: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    topStatLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
    }),
    topStatRow: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    topStatValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
    }),
    changeBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(0.25, 1),
      borderRadius: 999,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
    }),
    changeBadgeGood: css({
      color: theme.colors.success.text,
      border: `1px solid ${theme.colors.success.border}`,
      background: theme.colors.success.transparent,
    }),
    changeBadgeWarn: css({
      color: theme.colors.warning.text,
      border: `1px solid ${theme.colors.warning.border}`,
      background: theme.colors.warning.transparent,
    }),
    changeBadgeNeutral: css({
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      background: 'transparent',
    }),
    bspPanel: css({
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    bspHeader: css({
      padding: theme.spacing(1.5, 2),
      flexShrink: 0,
    }),
    bspTitle: css({
      display: 'block',
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing(0.25),
    }),
    bspValueRow: css({
      display: 'flex',
      alignItems: 'baseline',
      gap: theme.spacing(1),
    }),
    bspCenter: css({
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    bspBigValue: css({
      fontSize: 32,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      letterSpacing: '-0.02em',
      lineHeight: 1,
    }),
    bspList: css({
      flex: 1,
      overflowY: 'auto',
      padding: theme.spacing(0, 1, 1, 1),
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.25),
    }),
    bspBarRow: css({
      padding: theme.spacing(0, 1),
    }),
    bspBarMeta: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      marginBottom: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1,
    }),
    bspBarDot: css({
      width: 8,
      height: 8,
      borderRadius: '50%',
      flexShrink: 0,
    }),
    bspBarName: css({
      flex: 1,
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    bspBarValue: css({
      color: theme.colors.text.secondary,
      fontVariantNumeric: 'tabular-nums',
      flexShrink: 0,
    }),
    bspBarTrack: css({
      height: 6,
      borderRadius: 3,
      background: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    bspBarFill: css({
      height: '100%',
      borderRadius: 3,
      transition: 'width 0.3s ease',
    }),
    bspSingleLabel: css({
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    bspSegmentLegend: css({
      display: 'flex',
      gap: theme.spacing(1.5),
      marginTop: theme.spacing(0.5),
    }),
    bspSegmentLegendItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    panelRowFirstStat: css({
      display: 'grid',
      gridTemplateColumns: '2fr 3fr 3fr',
      gap: theme.spacing(1),
    }),
    panelRowLatency: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
    panelRowLatencyFull: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr 3fr',
      gap: theme.spacing(1),
    }),
    panelActions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    insightPanel: css({
      width: 280,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    insightPanelHeader: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(1.5, 2),
      flexShrink: 0,
    }),
    insightTitle: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    insightActions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    insightPlaceholder: css({
      color: theme.colors.text.secondary,
      fontStyle: 'italic',
    }),
    insightPanelBody: css({
      flex: 1,
      padding: theme.spacing(0, 2, 2),
      overflowY: 'auto',
      '& ul': {
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing(1.5),
      },
      '& li': {
        display: 'flex',
        gap: theme.spacing(1),
        padding: theme.spacing(1.5),
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.secondary,
        fontSize: theme.typography.bodySmall.fontSize,
        lineHeight: 1.6,
        color: theme.colors.text.secondary,
        '&::before': {
          content: '"→"',
          flexShrink: 0,
          color: theme.colors.text.disabled,
          fontWeight: theme.typography.fontWeightBold,
        },
      },
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.primary,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
  };
}
