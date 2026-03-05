import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Badge, Icon, LinkButton, Select, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type CostMode,
  type DashboardFilters,
  type LatencyPercentile,
  type PrometheusQueryResponse,
  type TokenDrilldown,
  breakdownToPromLabel,
  tokenDrilldownTypes,
} from '../../dashboard/types';
import { PLUGIN_BASE, buildConversationExploreRoute } from '../../constants';
import { type ConversationsDataSource, defaultConversationsDataSource } from '../../conversation/api';
import { buildConversationSearchFilter } from '../../conversation/filters';
import type { ConversationSearchResult } from '../../conversation/types';
import {
  extractResolvePairs,
  BreakdownStatPanel,
  getBreakdownStatPanelStyles,
  formatRelativeTime,
  formatWindowLabel,
} from './dashboardShared';
import { ViewConversationsLink, buildConversationsUrl } from './ViewConversationsLink';
import { TopStat } from '../TopStat';
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
import { PageInsightBar } from '../insight/PageInsightBar';
import { summarizeVector, summarizeMatrix, hasResponseData } from '../insight/summarize';
import { DashboardSummaryBar } from './DashboardSummaryBar';

export type DashboardGridProps = {
  dataSource: DashboardDataSource;
  conversationsDataSource?: ConversationsDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
  onTimeRangeChange: (timeRange: TimeRange) => void;
};

const CHART_HEIGHT = 250;

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

export function DashboardGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
  onTimeRangeChange,
}: DashboardGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const [latencyPercentile, setLatencyPercentile] = useState<LatencyPercentile>('p95');
  const [costMode, setCostMode] = useState<CostMode>('tokens');
  const [tokenDrilldown, setTokenDrilldown] = useState<TokenDrilldown>('all');

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

  // --- Previous period comparison (shifted back by the selected window size) ---
  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
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

  // latencyStat moved to Performance tab

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
    const pairs: Array<{ provider: string; model: string }> = [];
    pairs.push(...extractResolvePairs(costTokensData ?? undefined));
    pairs.push(...extractResolvePairs(costOverTimeData ?? undefined));
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
          f.fields[1].config = {
            ...f.fields[1].config,
            displayName: 'Success',
            color: { mode: 'fixed', fixedColor: 'green' },
          };
        }
      }
      frames.push(...successFrames);
    }
    if (requestsError.data) {
      const errorFrames = matrixToDataFrames(requestsError.data);
      for (const f of errorFrames) {
        f.name = 'Errors';
        if (f.fields[1]) {
          f.fields[1].config = {
            ...f.fields[1].config,
            displayName: 'Errors',
            color: { mode: 'fixed', fixedColor: 'red' },
          };
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
      'Dashboard context:',
      `Time range (raw): from=${String(timeRange.raw.from)}; to=${String(timeRange.raw.to)}`,
      `Time range (UTC): from=${formatUtcMillis(from)}; to=${formatUtcMillis(to)}`,
      `Breakdown: ${breakdownBy}`,
      `Latency percentile: ${latencyPercentile}`,
      `Cost mode: ${costMode}`,
      costMode === 'tokens' ? `Token drilldown: ${tokenDrilldown}` : null,
      '',
      summarizeVector(topTotalOps.data, 'Total Requests'),
      summarizeVector(topErrRate.data, 'Error Rate (%)'),
      summarizeMatrix(requestsSource, 'Requests over time'),
      summarizeMatrix(errorsTimeseries.data, 'Errors over time'),
      summarizeVector(topLatency.data, `Latency ${latencyPercentile} (seconds)`),
      summarizeMatrix(latencyTimeseries.data, 'Latency over time'),
    ].filter((part): part is string => part !== null);
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
    breakdownBy,
    from,
    to,
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
    timeRange.raw.from,
    timeRange.raw.to,
    tokensTotalStat.data,
    tokensTotalByBreakdown.data,
    tokensTotalTimeseries.data,
    tokensByTypeStat.data,
    tokensByTypeTimeseries.data,
    totalCost.totalCost,
    costTokens.data,
  ]);

  const insightPrompt = `Analyze this GenAI observability dashboard. Breakdown: ${breakdownBy}. Latency percentile: ${latencyPercentile}. Cost mode: ${costMode}${costMode === 'tokens' ? `. Token drilldown: ${tokenDrilldown}` : ''}. Only flag significant findings — anomalies, outliers, or actionable issues. Skip anything that looks normal.`;

  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;

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
      <DashboardSummaryBar>
        <TopStat
          label="Total Requests"
          value={totalRequestsValue}
          loading={topTotalOps.loading}
          prevValue={prevRequestsValue}
          prevLoading={prevTotalOps.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Avg Latency (P95)"
          value={latencyValue}
          unit="s"
          loading={topLatency.loading}
          prevValue={prevLatencyValue}
          prevLoading={prevLatency.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Error Rate"
          value={errorRateValue}
          unit="percent"
          loading={topErrRate.loading}
          prevValue={prevErrRateValue}
          prevLoading={prevErrRate.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Total Tokens"
          value={totalTokensValue}
          unit="short"
          loading={tokensTotalStat.loading}
          prevValue={prevTokensValue}
          prevLoading={prevTokensTotal.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Total Cost"
          value={totalCost.totalCost}
          unit="currencyUSD"
          loading={costTokens.loading || resolvedPricing.loading}
          prevValue={prevTotalCost.totalCost}
          prevLoading={prevCostTokens.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
      </DashboardSummaryBar>
      <PageInsightBar
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-insight"
        dataContext={insightDataContext}
        systemPrompt="You are a concise observability analyst. Return exactly 3-5 high-confidence suggestions. Include only suggestions strongly supported by the provided data; omit uncertain ideas. Each suggestion is a single short sentence on its own line prefixed with '- '. Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only."
      />

      <div className={styles.grid}>
        {/* Row 1: Requests & Errors */}
        <div className={styles.panelRowWithStat}>
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
            onChangeTimeRange={handlePanelTimeRangeChange}
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
            actions={<ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="time" />}
          />
          <MetricPanel
            title="Error rate"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={errorsTimeseries.loading}
            error={errorsTimeseries.error}
            data={errorsTimeseries.data ? matrixToDataFrames(errorsTimeseries.data) : []}
            options={errorOptions}
            fieldConfig={{
              defaults: {
                unit: 'percent',
                min: 0,
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
            actions={<ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="errors" />}
          />
        </div>

        {/* Row 2: Latency & TTFT */}
        <div className={styles.panelRowEqual}>
          <MetricPanel
            title="Latency"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
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
            actions={<ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="duration" />}
          />
          <MetricPanel
            title="Time to First Token"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
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
        <div className={styles.panelRowChartStat}>
          <MetricPanel
            title="Consumption"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
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
            actions={<ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="tokens" />}
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

      <RecentConversationsTable
        conversationsDataSource={conversationsDataSource}
        timeRange={timeRange}
        filters={filters}
      />
    </div>
  );
}

// --- Recent conversations table ---

const MAX_RECENT_ROWS = 10;

type RecentConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
};

function buildRecentSeeMoreUrl(timeRange: TimeRange, filters: DashboardFilters): string {
  return buildConversationsUrl(timeRange, filters, 'time');
}

function RecentConversationsTable({ conversationsDataSource, timeRange, filters }: RecentConversationsTableProps) {
  const styles = useStyles2(getStyles);
  const bspStyles = useStyles2(getBreakdownStatPanelStyles);
  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const versionRef = useRef(0);

  const fromISO = useMemo(() => timeRange.from.toISOString(), [timeRange.from]);
  const toISO = useMemo(() => timeRange.to.toISOString(), [timeRange.to]);
  const filterString = useMemo(() => buildConversationSearchFilter(filters), [filters]);

  useEffect(() => {
    const version = ++versionRef.current;
    setLoading(true);
    setError('');

    void (async () => {
      try {
        const response = await conversationsDataSource.searchConversations({
          filters: filterString,
          select: [],
          time_range: { from: fromISO, to: toISO },
          page_size: MAX_RECENT_ROWS,
        });
        if (versionRef.current !== version) {
          return;
        }
        setConversations(response.conversations ?? []);
      } catch (err) {
        if (versionRef.current !== version) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
        }
      }
    })();
  }, [conversationsDataSource, fromISO, toISO, filterString]);

  const title = 'Recent conversations';
  const seeMoreHref = buildRecentSeeMoreUrl(timeRange, filters);

  if (loading) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={bspStyles.bspCenter} style={{ padding: 32 }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error && conversations.length === 0) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={bspStyles.bspCenter} style={{ padding: 32, opacity: 0.6 }}>
          {error}
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={styles.emptyState}>
          <Icon name="comments-alt" size="xl" />
          <Text color="secondary">No conversations in this time range.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tablePanel}>
      <div className={styles.tablePanelHeader}>
        <span className={bspStyles.bspTitle}>{title}</span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.headerCell}>Conversation</th>
            <th className={styles.headerCell}>LLM calls</th>
            <th className={styles.headerCell}>Models</th>
            <th className={styles.headerCell}>Errors</th>
            <th className={styles.headerCell}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map((conversation) => (
            <tr
              key={conversation.conversation_id}
              className={styles.tableRow}
              onClick={(e) => {
                const href = `${PLUGIN_BASE}/${buildConversationExploreRoute(conversation.conversation_id)}`;
                if (e.metaKey || e.ctrlKey) {
                  window.open(href, '_blank');
                } else {
                  window.location.href = href;
                }
              }}
              role="link"
              aria-label={`view conversation ${conversation.conversation_id}`}
            >
              <td className={`${styles.tableCell} ${styles.idCell}`}>
                <span>{conversation.conversation_title?.trim() || conversation.conversation_id}</span>
              </td>
              <td className={styles.tableCell}>{conversation.generation_count}</td>
              <td className={styles.tableCell}>
                <div className={styles.modelList}>
                  {conversation.models.map((model) => (
                    <Badge key={model} text={model} color="blue" />
                  ))}
                  {conversation.models.length === 0 && <Text color="secondary">-</Text>}
                </div>
              </td>
              <td className={styles.tableCell}>
                {conversation.error_count > 0 ? (
                  <Badge text={String(conversation.error_count)} color="red" />
                ) : (
                  <Text color="secondary">0</Text>
                )}
              </td>
              <td className={styles.tableCell}>
                <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
                  <span>{formatRelativeTime(conversation.last_generation_at)}</span>
                </Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.seeMoreFooter}>
        <LinkButton href={seeMoreHref} variant="secondary" fill="text" size="sm" icon="arrow-right">
          See more conversations
        </LinkButton>
      </div>
    </div>
  );
}

function formatUtcMillis(ms: number): string {
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) {
    return 'invalid';
  }
  return dt.toISOString();
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
    panelRowEqual: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(1),
    }),
    panelRowWithStat: css({
      display: 'grid',
      gridTemplateColumns: '2fr 3fr 3fr',
      gap: theme.spacing(1),
    }),
    panelRowChartStat: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
    panelActions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    tablePanel: css({
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    tablePanelHeader: css({
      padding: theme.spacing(1.5, 2),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    table: css({
      width: '100%',
      borderCollapse: 'collapse',
    }),
    headerRow: css({
      borderBottom: `2px solid ${theme.colors.border.medium}`,
    }),
    headerCell: css({
      padding: theme.spacing(1, 1.5),
      textAlign: 'left',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
    }),
    tableRow: css({
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'background 0.1s ease',
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    tableCell: css({
      padding: theme.spacing(1, 1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      verticalAlign: 'middle',
    }),
    idCell: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
    }),
    modelList: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(0.5),
    }),
    emptyState: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(4),
      color: theme.colors.text.secondary,
    }),
    seeMoreFooter: css({
      display: 'flex',
      justifyContent: 'center',
      padding: theme.spacing(1),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
  };
}
