import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Badge, Text, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import DataTable, { type ColumnDef, getCommonCellStyles } from '../shared/DataTable';
import ModelChipList from '../shared/ModelChipList';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import {
  formatStatValue,
  extractResolvePairs,
  BreakdownStatPanel,
  stringHash,
  getBarPalette,
  formatRelativeTime,
  formatWindowLabel,
} from './dashboardShared';
import { TopStat } from '../TopStat';
import { lookupPricing, pricingKey, type PricingMap } from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalTokensQuery,
  tokensByBreakdownAndTypeQuery,
  cacheHitRateOverTimeQuery,
  cacheTokensByTypeOverTimeQuery,
  cacheReadOverTimeQuery,
  cacheReadByBreakdownQuery,
  cacheTokensByModelQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';
import { type ConversationsDataSource, defaultConversationsDataSource } from '../../conversation/api';
import { buildConversationSearchFilter } from '../../conversation/filters';
import type { ConversationSearchResult } from '../../conversation/types';
import { PLUGIN_BASE, ROUTES, buildConversationExploreRoute } from '../../constants';
import { ViewConversationsLink } from './ViewConversationsLink';
import { buildAgentDetailHref } from './ViewAgentsLink';
import { useModelCardBreakdownPopover } from './useModelCardBreakdownPopover';
import { PageInsightBar } from '../insight/PageInsightBar';
import { summarizeVector, summarizeMatrix, hasResponseData } from '../insight/summarize';
import { DashboardSummaryBar } from './DashboardSummaryBar';

export type DashboardCacheGridProps = {
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

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardCacheGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
  onTimeRangeChange,
}: DashboardCacheGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;
  const agentItemHref = useMemo(() => (breakdownBy === 'agent' ? buildAgentDetailHref : undefined), [breakdownBy]);

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

  // --- Top stats ---
  const cacheReadStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_read']),
    from,
    to,
    'instant'
  );
  const cacheWriteStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_write']),
    from,
    to,
    'instant'
  );
  const inputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['input']),
    from,
    to,
    'instant'
  );

  // --- Previous period comparison ---
  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
  const prevCacheReadStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_read']),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevCacheWriteStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_write']),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevInputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['input']),
    prevFrom,
    prevTo,
    'instant'
  );

  // Cache tokens by model for savings calculation
  const cacheByModelData = usePrometheusQuery(
    dataSource,
    cacheTokensByModelQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );
  const prevCacheByModelData = usePrometheusQuery(
    dataSource,
    cacheTokensByModelQuery(filters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );

  const resolvePairs = useMemo(() => {
    const pairs = cacheByModelData.data ? extractResolvePairs(cacheByModelData.data) : [];
    if (prevCacheByModelData.data) {
      pairs.push(...extractResolvePairs(prevCacheByModelData.data));
    }
    return pairs;
  }, [cacheByModelData.data, prevCacheByModelData.data]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  // --- Timeseries ---
  const cacheHitRateTimeseries = usePrometheusQuery(
    dataSource,
    cacheHitRateOverTimeQuery(filters, interval, hasBreakdown ? breakdownBy : 'none'),
    from,
    to,
    'range',
    step
  );

  const cacheTokensTimeseries = usePrometheusQuery(
    dataSource,
    cacheTokensByTypeOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );

  const cacheReadTimeseries = usePrometheusQuery(
    dataSource,
    hasBreakdown ? cacheReadOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Breakdown stat ---
  const cacheReadByBreakdown = usePrometheusQuery(
    dataSource,
    hasBreakdown ? cacheReadByBreakdownQuery(filters, rangeDuration, breakdownBy) : '',
    from,
    to,
    'instant'
  );

  // --- Cache tokens by breakdown + type (stacked: cache_read / cache_write) ---
  const cacheTokensByBreakdownAndType = usePrometheusQuery(
    dataSource,
    tokensByBreakdownAndTypeQuery(filters, rangeDuration, breakdownBy, ['cache_read', 'cache_write']),
    from,
    to,
    'instant'
  );

  const { onModelClick: onCacheModelClick, modelPopoverElement: cacheModelPopoverElement } =
    useModelCardBreakdownPopover('model', cacheByModelData.data);
  const { onModelClick, modelPopoverElement } = useModelCardBreakdownPopover(
    breakdownBy,
    cacheTokensByBreakdownAndType.data
  );
  const { onModelClick: onCacheReadModelClick, modelPopoverElement: cacheReadModelPopoverElement } =
    useModelCardBreakdownPopover(breakdownBy, cacheReadByBreakdown.data);

  // --- Derived values ---
  const cacheReadValue = cacheReadStat.data ? vectorToStatValue(cacheReadStat.data) : 0;
  const cacheWriteValue = cacheWriteStat.data ? vectorToStatValue(cacheWriteStat.data) : 0;
  const inputTokensValue = inputTokensStat.data ? vectorToStatValue(inputTokensStat.data) : 0;
  const cacheHitRate =
    inputTokensValue + cacheReadValue > 0 ? (cacheReadValue / (inputTokensValue + cacheReadValue)) * 100 : 0;

  const savings = useMemo(() => {
    return calculateCacheSavings(cacheByModelData.data ?? undefined, resolvedPricing.pricingMap);
  }, [cacheByModelData.data, resolvedPricing.pricingMap]);

  const prevCacheReadValue = prevCacheReadStat.data ? vectorToStatValue(prevCacheReadStat.data) : 0;
  const prevCacheWriteValue = prevCacheWriteStat.data ? vectorToStatValue(prevCacheWriteStat.data) : 0;
  const prevInputTokensValue = prevInputTokensStat.data ? vectorToStatValue(prevInputTokensStat.data) : 0;
  const prevCacheHitRate =
    prevInputTokensValue + prevCacheReadValue > 0
      ? (prevCacheReadValue / (prevInputTokensValue + prevCacheReadValue)) * 100
      : 0;
  const prevSavings = useMemo(() => {
    return calculateCacheSavings(prevCacheByModelData.data ?? undefined, resolvedPricing.pricingMap);
  }, [prevCacheByModelData.data, resolvedPricing.pricingMap]);
  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;

  const cacheHitRateByModelData = useMemo(
    () => buildCacheHitRateByModelResponse(cacheByModelData.data),
    [cacheByModelData.data]
  );

  const allDataLoading =
    cacheReadStat.loading ||
    cacheWriteStat.loading ||
    inputTokensStat.loading ||
    cacheByModelData.loading ||
    resolvedPricing.loading ||
    cacheHitRateTimeseries.loading ||
    cacheTokensTimeseries.loading ||
    cacheReadByBreakdown.loading;

  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const hasAnyData =
      hasResponseData(cacheReadStat.data) ||
      hasResponseData(cacheWriteStat.data) ||
      hasResponseData(inputTokensStat.data) ||
      hasResponseData(cacheHitRateTimeseries.data);
    if (!hasAnyData) {
      return null;
    }
    const parts = [
      'Cache dashboard context:',
      `Breakdown: ${breakdownBy}`,
      '',
      `Cache hit rate: ${cacheHitRate.toFixed(2)}%`,
      `Cache read tokens: ${cacheReadValue}`,
      `Cache write tokens: ${cacheWriteValue}`,
      `Input tokens: ${inputTokensValue}`,
      `Estimated savings (USD): $${savings.savings.toFixed(4)}`,
    ];
    if (savings.byModel.length > 0) {
      parts.push('');
      parts.push('Savings by model:');
      for (const m of savings.byModel) {
        parts.push(
          `  ${m.provider}/${m.model}: $${m.savings.toFixed(4)} saved, cache_hit_rate=${m.cacheHitRate.toFixed(1)}%`
        );
      }
    }
    parts.push('');
    parts.push(summarizeMatrix(cacheHitRateTimeseries.data, 'Cache hit rate over time'));
    parts.push(summarizeMatrix(cacheTokensTimeseries.data, 'Cache read vs write over time'));
    if (hasBreakdown) {
      parts.push(summarizeVector(cacheReadByBreakdown.data, `Cache read by ${breakdownBy}`));
    }
    return parts.join('\n');
  }, [
    allDataLoading,
    breakdownBy,
    cacheHitRate,
    cacheReadValue,
    cacheWriteValue,
    inputTokensValue,
    savings,
    cacheReadStat.data,
    cacheWriteStat.data,
    inputTokensStat.data,
    cacheHitRateTimeseries.data,
    cacheTokensTimeseries.data,
    hasBreakdown,
    cacheReadByBreakdown.data,
  ]);

  const insightPrompt = `Analyze this GenAI cache dashboard. Breakdown: ${breakdownBy}. Only flag significant findings — low cache utilization, savings opportunities, model-specific inefficiencies, or actionable issues. Skip anything that looks normal.`;

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const chartOptions = {
    legend: { displayMode: 'table', placement: 'right', calcs: ['mean'], maxWidth: 280 },
    tooltip: tooltipOptions,
  };
  const simpleOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <DashboardSummaryBar>
        <TopStat
          label="Cache Hit Rate"
          value={cacheHitRate}
          unit="percent"
          loading={cacheReadStat.loading || inputTokensStat.loading}
          prevValue={prevCacheHitRate}
          prevLoading={prevCacheReadStat.loading || prevInputTokensStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Cache Read Tokens"
          value={cacheReadValue}
          unit="short"
          loading={cacheReadStat.loading}
          prevValue={prevCacheReadValue}
          prevLoading={prevCacheReadStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Cache Write Tokens"
          value={cacheWriteValue}
          unit="short"
          loading={cacheWriteStat.loading}
          prevValue={prevCacheWriteValue}
          prevLoading={prevCacheWriteStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Input Tokens"
          value={inputTokensValue}
          unit="short"
          loading={inputTokensStat.loading}
          prevValue={prevInputTokensValue}
          prevLoading={prevInputTokensStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Estimated Savings"
          value={savings.savings}
          unit="currencyUSD"
          loading={cacheByModelData.loading || resolvedPricing.loading}
          prevValue={prevSavings.savings}
          prevLoading={prevCacheByModelData.loading || resolvedPricing.loading}
          comparisonLabel={comparisonLabel}
        />
      </DashboardSummaryBar>
      <PageInsightBar
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-cache-insight"
        dataContext={insightDataContext}
        systemPrompt="You are a concise observability analyst. Return exactly 3-5 high-confidence suggestions. Include only suggestions strongly supported by the provided data; omit uncertain ideas. Each suggestion is a single short sentence on its own line prefixed with '- '. Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only."
      />

      <div className={styles.grid}>
        {/* Row 1: Cache hit rate over time + cache hit rate by model */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Cache hit rate by ${breakdownBy}` : 'Cache hit rate over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={cacheHitRateTimeseries.loading}
            error={cacheHitRateTimeseries.error}
            data={cacheHitRateTimeseries.data ? matrixToDataFrames(cacheHitRateTimeseries.data) : []}
            options={hasBreakdown ? chartOptions : simpleOptions}
            fieldConfig={{
              defaults: {
                unit: 'percent',
                min: 0,
                max: 100,
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
            actions={<ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="tokens" />}
          />
          <BreakdownStatPanel
            title="Cache hit rate by model"
            data={cacheHitRateByModelData}
            loading={cacheByModelData.loading}
            error={cacheByModelData.error}
            breakdownLabel="model"
            height={CHART_HEIGHT}
            unit="percent"
            aggregation="avg"
            onItemClick={onCacheModelClick}
          />
        </div>

        {/* Row 2: Cache read vs write over time + cache tokens by type */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Cache read vs write over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={cacheTokensTimeseries.loading}
            error={cacheTokensTimeseries.error}
            data={cacheTokensTimeseries.data ? matrixToDataFrames(cacheTokensTimeseries.data) : []}
            options={simpleOptions}
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
            title={hasBreakdown ? `Cache tokens by ${breakdownBy}` : 'Cache tokens by type'}
            data={cacheTokensByBreakdownAndType.data}
            loading={cacheTokensByBreakdownAndType.loading}
            error={cacheTokensByBreakdownAndType.error}
            breakdownLabel={hasBreakdown ? breakdownPromLabel : 'gen_ai_token_type'}
            height={CHART_HEIGHT}
            segmentLabel={hasBreakdown ? 'gen_ai_token_type' : undefined}
            segmentNames={hasBreakdown ? ['cache_read', 'cache_write'] : undefined}
            getItemHref={agentItemHref}
            onItemClick={onModelClick}
          />
        </div>

        {/* Row 3: Cache read by breakdown + breakdown bar chart */}
        {hasBreakdown && (
          <div className={styles.panelRow}>
            <MetricPanel
              title={`Cache read tokens by ${breakdownBy}`}
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              onChangeTimeRange={handlePanelTimeRangeChange}
              loading={cacheReadTimeseries.loading}
              error={cacheReadTimeseries.error}
              data={cacheReadTimeseries.data ? matrixToDataFrames(cacheReadTimeseries.data) : []}
              options={chartOptions}
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
              title={`Cache read by ${breakdownBy}`}
              data={cacheReadByBreakdown.data}
              loading={cacheReadByBreakdown.loading}
              error={cacheReadByBreakdown.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
              getItemHref={agentItemHref}
              onItemClick={onCacheReadModelClick}
            />
          </div>
        )}

        {/* Savings breakdown by model */}
        {savings.byModel.length > 0 && <SavingsTable items={savings.byModel} />}
      </div>

      {/* Conversations with low cache utilization */}
      <CacheMissConversationsTable
        conversationsDataSource={conversationsDataSource}
        timeRange={timeRange}
        filters={filters}
      />
      {cacheModelPopoverElement}
      {modelPopoverElement}
      {cacheReadModelPopoverElement}
    </div>
  );
}

// --- Savings calculation ---

type ModelSavings = {
  model: string;
  provider: string;
  cacheReadTokens: number;
  inputTokens: number;
  cacheHitRate: number;
  savings: number;
};

type CacheSavingsResult = {
  savings: number;
  byModel: ModelSavings[];
};

function calculateCacheSavings(
  response: PrometheusQueryResponse | undefined,
  pricingMap: PricingMap
): CacheSavingsResult {
  if (!response || response.data.resultType !== 'vector') {
    return { savings: 0, byModel: [] };
  }
  const results = response.data.result as Array<{
    metric: Record<string, string>;
    value: [number, string];
  }>;

  // Group by model: collect cache_read and input token counts
  const modelTokens = new Map<string, { provider: string; model: string; cacheRead: number; input: number }>();
  for (const r of results) {
    const provider = r.metric.gen_ai_provider_name ?? '';
    const model = r.metric.gen_ai_request_model ?? '';
    const tokenType = r.metric.gen_ai_token_type ?? '';
    const count = parseFloat(r.value[1]);
    if (!isFinite(count) || !provider || !model) {
      continue;
    }
    const key = pricingKey(provider, model);
    if (!modelTokens.has(key)) {
      modelTokens.set(key, { provider, model, cacheRead: 0, input: 0 });
    }
    const entry = modelTokens.get(key)!;
    if (tokenType === 'cache_read') {
      entry.cacheRead += count;
    } else if (tokenType === 'input') {
      entry.input += count;
    }
  }

  let totalSavings = 0;
  const byModel: ModelSavings[] = [];

  for (const [, entry] of modelTokens) {
    if (entry.cacheRead <= 0) {
      continue;
    }
    const pricing = lookupPricing(pricingMap, entry.model, entry.provider);
    if (!pricing) {
      continue;
    }
    const fullInputCost = entry.cacheRead * (pricing.prompt_usd_per_token ?? 0);
    const cachedCost = entry.cacheRead * (pricing.input_cache_read_usd_per_token ?? 0);
    const saved = fullInputCost - cachedCost;
    if (saved <= 0) {
      continue;
    }
    totalSavings += saved;
    const hitRate = entry.cacheRead + entry.input > 0 ? (entry.cacheRead / (entry.cacheRead + entry.input)) * 100 : 0;
    byModel.push({
      model: entry.model,
      provider: entry.provider,
      cacheReadTokens: entry.cacheRead,
      inputTokens: entry.input,
      cacheHitRate: hitRate,
      savings: saved,
    });
  }

  byModel.sort((a, b) => b.savings - a.savings);
  return { savings: totalSavings, byModel };
}

function buildCacheHitRateByModelResponse(
  response: PrometheusQueryResponse | null | undefined
): PrometheusQueryResponse | null {
  if (!response || response.data.resultType !== 'vector') {
    return null;
  }
  const results = response.data.result as Array<{
    metric: Record<string, string>;
    value: [number, string];
  }>;

  const modelTokens = new Map<string, { model: string; cacheRead: number; input: number }>();
  for (const r of results) {
    const model = r.metric.gen_ai_request_model ?? '';
    const tokenType = r.metric.gen_ai_token_type ?? '';
    const count = parseFloat(r.value[1]);
    if (!isFinite(count) || !model) {
      continue;
    }
    if (!modelTokens.has(model)) {
      modelTokens.set(model, { model, cacheRead: 0, input: 0 });
    }
    const entry = modelTokens.get(model)!;
    if (tokenType === 'cache_read') {
      entry.cacheRead += count;
    } else if (tokenType === 'input') {
      entry.input += count;
    }
  }

  const vectorResults: Array<{ metric: Record<string, string>; value: [number, string] }> = [];
  for (const [, entry] of modelTokens) {
    const total = entry.cacheRead + entry.input;
    if (total <= 0) {
      continue;
    }
    const hitRate = (entry.cacheRead / total) * 100;
    vectorResults.push({
      metric: { model: entry.model },
      value: [0, String(hitRate)],
    });
  }

  return {
    status: 'success',
    data: { resultType: 'vector', result: vectorResults },
  };
}

type SavingsTableProps = {
  items: ModelSavings[];
};

function SavingsTable({ items }: SavingsTableProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const palette = useMemo(() => getBarPalette(theme), [theme]);
  const maxSavings = items.length > 0 ? items[0].savings : 0;
  const totalSavings = useMemo(() => items.reduce((s, i) => s + i.savings, 0), [items]);

  const columns = useMemo<Array<ColumnDef<ModelSavings>>>(
    () => [
      {
        id: 'model',
        header: 'Model',
        cell: (item: ModelSavings) => <ModelChipList models={[item.model]} maxVisible={1} />,
      },
      {
        id: 'savings',
        header: 'Savings',
        cell: (item: ModelSavings) => {
          const barWidth = maxSavings > 0 ? (item.savings / maxSavings) * 100 : 0;
          const color = palette[stringHash(`${item.provider}::${item.model}`) % palette.length];
          return (
            <div className={styles.savingsCell}>
              <div className={styles.cacheBarTrack}>
                <div className={styles.cacheBarFill} style={{ width: `${barWidth}%`, background: color }} />
              </div>
              <span className={styles.cacheBarLabel}>{formatStatValue(item.savings, 'currencyUSD')}</span>
            </div>
          );
        },
      },
      {
        id: 'cacheHitRate',
        header: 'Cache hit rate',
        cell: (item: ModelSavings) => formatStatValue(item.cacheHitRate, 'percent'),
      },
    ],
    [maxSavings, palette, styles.cacheBarTrack, styles.cacheBarFill, styles.cacheBarLabel, styles.savingsCell]
  );

  return (
    <DataTable<ModelSavings>
      columns={columns}
      data={items}
      keyOf={(item) => `${item.provider}::${item.model}`}
      panelTitle="Cache savings by model"
      panelSubtitle={formatStatValue(totalSavings, 'currencyUSD')}
      loading={false}
      emptyIcon="piggy-bank"
      emptyMessage="No cache savings in this period."
    />
  );
}

// --- Conversations with low cache utilization ---

const MAX_CACHE_ROWS = 10;
const CACHE_SELECT_FIELDS = ['span.gen_ai.usage.input_tokens', 'span.gen_ai.usage.cache_read_input_tokens'];

type CacheMissConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
};

function buildCacheSeeMoreUrl(timeRange: TimeRange, filters: DashboardFilters): string {
  const params = new URLSearchParams();
  params.set('from', String(timeRange.raw.from));
  params.set('to', String(timeRange.raw.to));
  for (const p of filters.providers) {
    params.append('provider', p);
  }
  for (const m of filters.models) {
    params.append('model', m);
  }
  for (const a of filters.agentNames) {
    params.append('agent', a);
  }
  for (const lf of filters.labelFilters) {
    if (lf.key && lf.value) {
      params.append('label', `${lf.key}|${lf.operator}|${lf.value}`);
    }
  }
  return `${PLUGIN_BASE}/${ROUTES.Conversations}?${params.toString()}`;
}

type CacheMissRow = ConversationSearchResult & {
  inputTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number;
};

function CacheMissConversationsTable({
  conversationsDataSource,
  timeRange,
  filters,
}: CacheMissConversationsTableProps) {
  const styles = useStyles2(getStyles);
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
        let cursor = '';
        let hasMore = true;
        const all: ConversationSearchResult[] = [];
        // Cap pages to avoid unbounded fetches; the API lacks server-side ordering,
        // so we approximate "top N" from a bounded sample.
        const maxPages = 5;
        let page = 0;

        while (hasMore && page < maxPages) {
          const response = await conversationsDataSource.searchConversations({
            filters: filterString,
            select: CACHE_SELECT_FIELDS,
            time_range: { from: fromISO, to: toISO },
            page_size: 100,
            cursor,
          });
          if (versionRef.current !== version) {
            return;
          }
          all.push(...(response.conversations ?? []));
          cursor = response.next_cursor ?? '';
          hasMore = Boolean(response.has_more && cursor.length > 0);
          page++;
        }

        const withStats = all.map((c) => {
          const inputTokens = (c.selected?.['span.gen_ai.usage.input_tokens'] as number) ?? 0;
          const cacheReadTokens = (c.selected?.['span.gen_ai.usage.cache_read_input_tokens'] as number) ?? 0;
          const total = inputTokens + cacheReadTokens;
          const cacheHitRate = total > 0 ? (cacheReadTokens / total) * 100 : 0;
          return { ...c, inputTokens, cacheReadTokens, cacheHitRate };
        });
        withStats.sort((a, b) => a.cacheHitRate - b.cacheHitRate);

        setConversations(withStats.slice(0, MAX_CACHE_ROWS));
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

  const withCacheStats = useMemo<CacheMissRow[]>(() => {
    return conversations.map((c) => {
      const inputTokens = (c.selected?.['span.gen_ai.usage.input_tokens'] as number) ?? 0;
      const cacheReadTokens = (c.selected?.['span.gen_ai.usage.cache_read_input_tokens'] as number) ?? 0;
      const total = inputTokens + cacheReadTokens;
      const cacheHitRate = total > 0 ? (cacheReadTokens / total) * 100 : 0;
      return { ...c, inputTokens, cacheReadTokens, cacheHitRate };
    });
  }, [conversations]);

  const columns = useMemo<Array<ColumnDef<CacheMissRow>>>(
    () => [
      {
        id: 'conversation',
        header: 'Conversation',
        cell: (c: CacheMissRow) => (
          <span className={styles.monoCell}>{c.conversation_title?.trim() || c.conversation_id}</span>
        ),
      },
      {
        id: 'llmCalls',
        header: 'LLM calls',
        cell: (c: CacheMissRow) => c.generation_count,
      },
      {
        id: 'models',
        header: 'Models',
        cell: (c: CacheMissRow) => <ModelChipList models={c.models} />,
      },
      {
        id: 'inputTokens',
        header: 'Input tokens',
        cell: (c: CacheMissRow) => formatStatValue(c.inputTokens),
      },
      {
        id: 'cacheReadTokens',
        header: 'Cache read tokens',
        cell: (c: CacheMissRow) =>
          c.cacheReadTokens > 0 ? formatStatValue(c.cacheReadTokens) : <Text color="secondary">0</Text>,
      },
      {
        id: 'cacheHitRate',
        header: 'Cache hit rate',
        cell: (c: CacheMissRow) => <CacheHitRateBadge rate={c.cacheHitRate} />,
      },
      {
        id: 'lastActivity',
        header: 'Last activity',
        cell: (c: CacheMissRow) => (
          <Tooltip content={new Date(c.last_generation_at).toLocaleString()} placement="left">
            <span>{formatRelativeTime(c.last_generation_at)}</span>
          </Tooltip>
        ),
      },
    ],
    [styles.monoCell]
  );

  const handleRowClick = useCallback((c: CacheMissRow, e: React.MouseEvent) => {
    const href = `${PLUGIN_BASE}/${buildConversationExploreRoute(c.conversation_id)}`;
    if (e.metaKey || e.ctrlKey) {
      window.open(href, '_blank');
    } else {
      window.location.href = href;
    }
  }, []);

  return (
    <DataTable<CacheMissRow>
      columns={columns}
      data={withCacheStats}
      keyOf={(c) => c.conversation_id}
      onRowClick={handleRowClick}
      rowRole="link"
      rowAriaLabel={(c) => `view conversation ${c.conversation_id}`}
      panelTitle="Conversations with low cache utilization"
      loading={loading}
      loadError={error}
      emptyIcon="check-circle"
      emptyMessage="No conversations found in this time range."
      seeMoreHref={buildCacheSeeMoreUrl(timeRange, filters)}
      seeMoreLabel="See more conversations"
    />
  );
}

function CacheHitRateBadge({ rate }: { rate: number }) {
  if (rate === 0) {
    return <Badge text="0%" color="red" />;
  }
  if (rate < 20) {
    return <Badge text={formatStatValue(rate, 'percent')} color="orange" />;
  }
  return <Badge text={formatStatValue(rate, 'percent')} color="green" />;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    ...getCommonCellStyles(theme),
    savingsCell: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      minWidth: 100,
    }),
    cacheBarTrack: css({
      flex: 1,
      height: 6,
      borderRadius: 3,
      background: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    cacheBarFill: css({
      height: '100%',
      borderRadius: 3,
      transition: 'width 0.2s ease',
    }),
    cacheBarLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      minWidth: 60,
      textAlign: 'right' as const,
    }),
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
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
  };
}
