import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import type { DashboardFilters, ModelResolvePair, PrometheusQueryResponse } from '../../dashboard/types';
import { calculateTotalCost, calculateCostTimeSeries } from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalOpsQuery,
  totalTokensQuery,
  totalErrorsQuery,
  errorRateQuery,
  tokenUsageOverTimeQuery,
  tokenUsageByModelQuery,
  rpsByModelOverTimeQuery,
  callsByProviderQuery,
  topModelsQuery,
  latencyP95Query,
  ttftP95Query,
  tokensByModelAndTypeQuery,
} from '../../dashboard/queries';
import {
  matrixToDataFrames,
  vectorToPieDataFrame,
  vectorToStatValue,
  statValueToDataFrame,
} from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';

export type DashboardGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  from: number;
  to: number;
  timeRange: TimeRange;
};

const STAT_HEIGHT = 120;
const CHART_HEIGHT = 300;

export function DashboardGrid({ dataSource, filters, from, to, timeRange }: DashboardGridProps) {
  const styles = useStyles2(getStyles);

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  // Stat queries (instant)
  const totalOps = usePrometheusQuery(dataSource, totalOpsQuery(filters, rangeDuration), from, to, 'instant');
  const totalTokens = usePrometheusQuery(dataSource, totalTokensQuery(filters, rangeDuration), from, to, 'instant');
  const totalErrors = usePrometheusQuery(dataSource, totalErrorsQuery(filters, rangeDuration), from, to, 'instant');
  const errRate = usePrometheusQuery(dataSource, errorRateQuery(filters, rangeDuration), from, to, 'instant');

  // Cost query (instant, per model+type for client-side pricing)
  const costTokens = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );

  // Timeseries queries (range)
  const tokensOverTime = usePrometheusQuery(
    dataSource,
    tokenUsageOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const tokensByModel = usePrometheusQuery(
    dataSource,
    tokenUsageByModelQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const rpsByModel = usePrometheusQuery(
    dataSource,
    rpsByModelOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const latency = usePrometheusQuery(dataSource, latencyP95Query(filters, interval), from, to, 'range', step);
  const ttft = usePrometheusQuery(dataSource, ttftP95Query(filters, interval), from, to, 'range', step);

  // Piechart queries (instant)
  const byProvider = usePrometheusQuery(dataSource, callsByProviderQuery(filters, rangeDuration), from, to, 'instant');
  const byModel = usePrometheusQuery(dataSource, topModelsQuery(filters, rangeDuration), from, to, 'instant');

  // Computed cost
  const costTokensData = costTokens.data ?? undefined;
  const tokensByModelData = tokensByModel.data ?? undefined;

  const resolvePairs = useMemo(() => {
    const pairs: ModelResolvePair[] = [];
    pairs.push(...extractResolvePairs(costTokensData));
    pairs.push(...extractResolvePairs(tokensByModelData));
    return pairs;
  }, [costTokensData, tokensByModelData]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  const totalCost = useMemo(() => {
    return calculateTotalCost(costTokensData, resolvedPricing.pricingMap);
  }, [costTokensData, resolvedPricing.pricingMap]);

  const costTimeSeries = useMemo(() => {
    if (!tokensByModelData) {
      return [];
    }
    return [calculateCostTimeSeries(tokensByModelData, resolvedPricing.pricingMap)];
  }, [tokensByModelData, resolvedPricing.pricingMap]);

  const unresolvedSummary = useMemo(() => {
    if (totalCost.unresolvedSeries.length === 0) {
      return '';
    }
    const reasonByPair = new Map<string, string>();
    for (const item of resolvedPricing.unresolved) {
      const pair = `${item.provider}/${item.model}`;
      if (!item.reason || reasonByPair.has(pair)) {
        continue;
      }
      reasonByPair.set(pair, item.reason);
    }

    const countsByPair = new Map<string, number>();
    for (const series of totalCost.unresolvedSeries) {
      const pair = `${series.provider}/${series.model}`;
      countsByPair.set(pair, (countsByPair.get(pair) ?? 0) + series.count);
    }

    const sortedPairs = Array.from(countsByPair.entries()).sort((a, b) => b[1] - a[1]);
    const topPairs = sortedPairs.slice(0, 3).map(([pair]) => {
      const reason = reasonByPair.get(pair);
      return reason ? `${pair} (${reason})` : pair;
    });
    const remaining = sortedPairs.length - topPairs.length;
    const suffix = remaining > 0 ? ` +${remaining} more` : '';
    return `Excluded ${Math.round(totalCost.unresolvedTokens)} unresolved tokens: ${topPairs.join(', ')}${suffix}.`;
  }, [resolvedPricing.unresolved, totalCost.unresolvedSeries, totalCost.unresolvedTokens]);

  const costDescription = useMemo(() => {
    const details: string[] = ['Cost computed from token totals and resolved model-card pricing.'];
    if (resolvedPricing.error) {
      details.push(`Resolver error: ${resolvedPricing.error}.`);
    }
    if (unresolvedSummary) {
      details.push(unresolvedSummary);
    }
    return details.join(' ');
  }, [resolvedPricing.error, unresolvedSummary]);

  const costLoading = costTokens.loading || resolvedPricing.loading;
  const costSeriesLoading = tokensByModel.loading || resolvedPricing.loading;

  return (
    <div className={styles.grid}>
      {/* Stat row */}
      <div className={styles.statRow}>
        <MetricPanel
          title="Total Operations"
          pluginId="stat"
          height={STAT_HEIGHT}
          timeRange={timeRange}
          loading={totalOps.loading}
          error={totalOps.error}
          data={[statValueToDataFrame(totalOps.data ? vectorToStatValue(totalOps.data) : 0, 'Operations')]}
        />
        <MetricPanel
          title="Total Tokens"
          pluginId="stat"
          height={STAT_HEIGHT}
          timeRange={timeRange}
          loading={totalTokens.loading}
          error={totalTokens.error}
          data={[statValueToDataFrame(totalTokens.data ? vectorToStatValue(totalTokens.data) : 0, 'Tokens')]}
        />
        <MetricPanel
          title="Total Errors"
          pluginId="stat"
          height={STAT_HEIGHT}
          timeRange={timeRange}
          loading={totalErrors.loading}
          error={totalErrors.error}
          data={[statValueToDataFrame(totalErrors.data ? vectorToStatValue(totalErrors.data) : 0, 'Errors')]}
          fieldConfig={{
            defaults: { color: { mode: 'fixed', fixedColor: 'red' } },
            overrides: [],
          }}
        />
        <MetricPanel
          title="Error Rate"
          pluginId="stat"
          height={STAT_HEIGHT}
          timeRange={timeRange}
          loading={errRate.loading}
          error={errRate.error}
          data={[statValueToDataFrame(errRate.data ? vectorToStatValue(errRate.data) : 0, 'Error Rate', 'percent')]}
        />
        <MetricPanel
          title="Estimated Cost"
          description={costDescription}
          pluginId="stat"
          height={STAT_HEIGHT}
          timeRange={timeRange}
          loading={costLoading}
          error={costTokens.error}
          data={[statValueToDataFrame(totalCost.totalCost, 'Cost', 'currencyUSD')]}
        />
        <MetricPanel
          title="Unpriced Tokens"
          description="Tokens excluded from cost because model-card pricing could not be resolved"
          pluginId="stat"
          height={STAT_HEIGHT}
          timeRange={timeRange}
          loading={costLoading}
          error={costTokens.error}
          data={[statValueToDataFrame(totalCost.unresolvedTokens, 'Unpriced Tokens')]}
        />
      </div>

      {/* Token usage over time */}
      <MetricPanel
        title="Token Usage Over Time"
        description="Breakdown by token type (input, output, cache, reasoning)"
        pluginId="timeseries"
        height={CHART_HEIGHT}
        timeRange={timeRange}
        loading={tokensOverTime.loading}
        error={tokensOverTime.error}
        data={tokensOverTime.data ? matrixToDataFrames(tokensOverTime.data) : []}
      />

      {/* Cost over time */}
      <MetricPanel
        title="Estimated Cost Over Time"
        description="Cost computed from token rates and model card pricing"
        pluginId="timeseries"
        height={CHART_HEIGHT}
        timeRange={timeRange}
        loading={costSeriesLoading}
        error={tokensByModel.error}
        data={costTimeSeries}
      />

      <MetricPanel
        title="RPS Over Time by Model"
        description="Request rate grouped by provider and model"
        pluginId="timeseries"
        height={CHART_HEIGHT}
        timeRange={timeRange}
        loading={rpsByModel.loading}
        error={rpsByModel.error}
        data={rpsByModel.data ? matrixToDataFrames(rpsByModel.data) : []}
        fieldConfig={{
          defaults: {
            unit: 'reqps',
            custom: {
              drawStyle: 'bars',
              lineWidth: 0,
              fillOpacity: 90,
              showPoints: 'never',
              stacking: { mode: 'normal', group: 'A' },
            },
          },
          overrides: [],
        }}
      />

      {/* Two-column row: piecharts */}
      <div className={styles.twoColRow}>
        <MetricPanel
          title="Calls by Provider"
          pluginId="piechart"
          height={CHART_HEIGHT}
          timeRange={timeRange}
          loading={byProvider.loading}
          error={byProvider.error}
          data={byProvider.data ? [vectorToPieDataFrame(byProvider.data, ['gen_ai_provider_name'])] : []}
        />
        <MetricPanel
          title="Top Models"
          pluginId="piechart"
          height={CHART_HEIGHT}
          timeRange={timeRange}
          loading={byModel.loading}
          error={byModel.error}
          data={
            byModel.data
              ? [vectorToPieDataFrame(byModel.data, ['gen_ai_provider_name', 'gen_ai_request_model'], '/')]
              : []
          }
        />
      </div>

      {/* Two-column row: latency */}
      <div className={styles.twoColRow}>
        <MetricPanel
          title="Latency P95"
          description="95th percentile operation duration"
          pluginId="timeseries"
          height={CHART_HEIGHT}
          timeRange={timeRange}
          loading={latency.loading}
          error={latency.error}
          data={latency.data ? matrixToDataFrames(latency.data) : []}
          fieldConfig={{
            defaults: { unit: 's' },
            overrides: [],
          }}
        />
        <MetricPanel
          title="Time to First Token P95"
          description="95th percentile TTFT (streaming only)"
          pluginId="timeseries"
          height={CHART_HEIGHT}
          timeRange={timeRange}
          loading={ttft.loading}
          error={ttft.error}
          data={ttft.data ? matrixToDataFrames(ttft.data) : []}
          fieldConfig={{
            defaults: { unit: 's' },
            overrides: [],
          }}
        />
      </div>
    </div>
  );
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
    grid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    statRow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: theme.spacing(1),
    }),
    twoColRow: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(1),
    }),
  };
}
