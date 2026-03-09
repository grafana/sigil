import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Badge, Text, Tooltip, useStyles2 } from '@grafana/ui';
import DataTable, { type ColumnDef, getCommonCellStyles } from '../shared/DataTable';
import ModelChipList from '../shared/ModelChipList';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type ModelResolvePair,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import { extractResolvePairs, BreakdownStatPanel, formatRelativeTime, formatWindowLabel } from './dashboardShared';
import { TopStat } from '../TopStat';
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

export type DashboardConsumptionGridProps = {
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

export function DashboardConsumptionGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
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

  // --- Previous period comparison ---
  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
  const prevTokensTotalStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration),
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
  const prevOutputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['output']),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevCacheReadTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_read']),
    prevFrom,
    prevTo,
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
  const prevCostTokensData = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, 'none'),
    prevFrom,
    prevTo,
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
    if (prevCostTokensData.data) {
      pairs.push(...extractResolvePairs(prevCostTokensData.data));
    }
    return pairs;
  }, [costTokensData.data, costOverTimeData.data, prevCostTokensData.data]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  const totalCost = useMemo(() => {
    return calculateTotalCost(costTokensData.data ?? undefined, resolvedPricing.pricingMap);
  }, [costTokensData.data, resolvedPricing.pricingMap]);

  const prevTotalCost = useMemo(() => {
    return calculateTotalCost(prevCostTokensData.data ?? undefined, resolvedPricing.pricingMap);
  }, [prevCostTokensData.data, resolvedPricing.pricingMap]);

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

  const { onModelClick, modelPopoverElement } = useModelCardBreakdownPopover(breakdownBy, tokensByBreakdown.data);

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

  const prevTotalTokensValue = prevTokensTotalStat.data ? vectorToStatValue(prevTokensTotalStat.data) : 0;
  const prevInputTokensValue = prevInputTokensStat.data ? vectorToStatValue(prevInputTokensStat.data) : 0;
  const prevOutputTokensValue = prevOutputTokensStat.data ? vectorToStatValue(prevOutputTokensStat.data) : 0;
  const prevCacheReadValue = prevCacheReadTokensStat.data ? vectorToStatValue(prevCacheReadTokensStat.data) : 0;
  const prevCacheHitRate =
    prevInputTokensValue + prevCacheReadValue > 0
      ? (prevCacheReadValue / (prevInputTokensValue + prevCacheReadValue)) * 100
      : 0;
  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;

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
      <DashboardSummaryBar>
        <TopStat
          label="Total Tokens"
          value={totalTokensValue}
          unit="short"
          loading={tokensTotalStat.loading}
          prevValue={prevTotalTokensValue}
          prevLoading={prevTokensTotalStat.loading}
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
          label="Output Tokens"
          value={outputTokensValue}
          unit="short"
          loading={outputTokensStat.loading}
          prevValue={prevOutputTokensValue}
          prevLoading={prevOutputTokensStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Cache Read"
          value={cacheReadValue}
          unit="short"
          loading={cacheReadTokensStat.loading}
          prevValue={prevCacheReadValue}
          prevLoading={prevCacheReadTokensStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Cache Hit Rate"
          value={cacheHitRate}
          unit="percent"
          loading={cacheReadTokensStat.loading || inputTokensStat.loading}
          prevValue={prevCacheHitRate}
          prevLoading={prevCacheReadTokensStat.loading || prevInputTokensStat.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Estimated Cost"
          value={totalCost.totalCost}
          unit="currencyUSD"
          loading={costTokensData.loading || resolvedPricing.loading}
          prevValue={prevTotalCost.totalCost}
          prevLoading={prevCostTokensData.loading || resolvedPricing.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
      </DashboardSummaryBar>
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
            actions={<ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="tokens" />}
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
              getItemHref={agentItemHref}
              onItemClick={onModelClick}
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
            getItemHref={agentItemHref}
            onItemClick={onModelClick}
          />
        </div>
      </div>

      <MostTokensConversationsTable
        conversationsDataSource={conversationsDataSource}
        timeRange={timeRange}
        filters={filters}
      />
      {modelPopoverElement}
    </div>
  );
}

// --- Most tokens conversations table ---

const MAX_TOKEN_ROWS = 10;
const INPUT_TOKENS_SELECT_KEY = 'span.gen_ai.usage.input_tokens';
const OUTPUT_TOKENS_SELECT_KEY = 'span.gen_ai.usage.output_tokens';

function getConversationTotalTokens(conversation: ConversationSearchResult): number {
  const input = conversation.selected?.[INPUT_TOKENS_SELECT_KEY];
  const output = conversation.selected?.[OUTPUT_TOKENS_SELECT_KEY];
  return (typeof input === 'number' ? input : 0) + (typeof output === 'number' ? output : 0);
}

function formatTokenCount(tokens: number): string {
  if (tokens <= 0) {
    return '-';
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

type MostTokensTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
};

function buildTokensSeeMoreUrl(timeRange: TimeRange, filters: DashboardFilters): string {
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
  params.set('orderBy', 'tokens');
  return `${PLUGIN_BASE}/${ROUTES.Conversations}?${params.toString()}`;
}

function MostTokensConversationsTable({ conversationsDataSource, timeRange, filters }: MostTokensTableProps) {
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
            select: [INPUT_TOKENS_SELECT_KEY, OUTPUT_TOKENS_SELECT_KEY],
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

        all.sort((a, b) => getConversationTotalTokens(b) - getConversationTotalTokens(a));

        setConversations(all.slice(0, MAX_TOKEN_ROWS));
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

  const columns = useMemo<Array<ColumnDef<ConversationSearchResult>>>(
    () => [
      {
        id: 'conversation',
        header: 'Conversation',
        cell: (c: ConversationSearchResult) => (
          <span className={styles.monoCell}>{c.conversation_title?.trim() || c.conversation_id}</span>
        ),
      },
      {
        id: 'totalTokens',
        header: 'Total tokens',
        cell: (c: ConversationSearchResult) => formatTokenCount(getConversationTotalTokens(c)),
      },
      {
        id: 'llmCalls',
        header: 'LLM calls',
        cell: (c: ConversationSearchResult) => c.generation_count,
      },
      {
        id: 'models',
        header: 'Models',
        cell: (c: ConversationSearchResult) => <ModelChipList models={c.models} />,
      },
      {
        id: 'errors',
        header: 'Errors',
        cell: (c: ConversationSearchResult) =>
          c.error_count > 0 ? <Badge text={String(c.error_count)} color="red" /> : <Text color="secondary">0</Text>,
      },
      {
        id: 'lastActivity',
        header: 'Last activity',
        cell: (c: ConversationSearchResult) => (
          <Tooltip content={new Date(c.last_generation_at).toLocaleString()} placement="left">
            <span>{formatRelativeTime(c.last_generation_at)}</span>
          </Tooltip>
        ),
      },
    ],
    [styles.monoCell]
  );

  const handleRowClick = useCallback((conversation: ConversationSearchResult, e: React.MouseEvent) => {
    const href = `${PLUGIN_BASE}/${buildConversationExploreRoute(conversation.conversation_id)}`;
    if (e.metaKey || e.ctrlKey) {
      window.open(href, '_blank');
    } else {
      window.location.href = href;
    }
  }, []);

  return (
    <DataTable<ConversationSearchResult>
      columns={columns}
      data={conversations}
      keyOf={(c) => c.conversation_id}
      onRowClick={handleRowClick}
      rowRole="link"
      rowAriaLabel={(c) => `view conversation ${c.conversation_id}`}
      panelTitle="Highest token usage conversations"
      loading={loading}
      loadError={error && conversations.length === 0 ? error : undefined}
      emptyIcon="dashboard"
      emptyMessage="No conversations in this time range."
      seeMoreHref={buildTokensSeeMoreUrl(timeRange, filters)}
      seeMoreLabel="See more conversations"
    />
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    ...getCommonCellStyles(theme),
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
