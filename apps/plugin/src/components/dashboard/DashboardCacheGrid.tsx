import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { ThresholdsMode, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Badge, Button, Icon, Spinner, Text, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import {
  formatStatValue,
  StatItem,
  extractResolvePairs,
  BreakdownStatPanel,
  getBreakdownStatPanelStyles,
  stringHash,
  getBarPalette,
  formatRelativeTime,
} from './dashboardShared';
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
import type { ConversationSearchResult } from '../../conversation/types';
import { PLUGIN_BASE, buildConversationDetailRoute } from '../../constants';

export type DashboardCacheGridProps = {
  dataSource: DashboardDataSource;
  conversationsDataSource?: ConversationsDataSource;
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

export function DashboardCacheGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
}: DashboardCacheGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

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

  // Cache tokens by model for savings calculation
  const cacheByModelData = usePrometheusQuery(
    dataSource,
    cacheTokensByModelQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );

  const resolvePairs = useMemo(() => {
    if (!cacheByModelData.data) {
      return [];
    }
    return extractResolvePairs(cacheByModelData.data);
  }, [cacheByModelData.data]);
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

  // --- Derived values ---
  const cacheReadValue = cacheReadStat.data ? vectorToStatValue(cacheReadStat.data) : 0;
  const cacheWriteValue = cacheWriteStat.data ? vectorToStatValue(cacheWriteStat.data) : 0;
  const inputTokensValue = inputTokensStat.data ? vectorToStatValue(inputTokensStat.data) : 0;
  const cacheHitRate =
    inputTokensValue + cacheReadValue > 0 ? (cacheReadValue / (inputTokensValue + cacheReadValue)) * 100 : 0;

  const savings = useMemo(() => {
    return calculateCacheSavings(cacheByModelData.data ?? undefined, resolvedPricing.pricingMap);
  }, [cacheByModelData.data, resolvedPricing.pricingMap]);

  const cacheHitRateByModelData = useMemo(
    () => buildCacheHitRateByModelResponse(cacheByModelData.data),
    [cacheByModelData.data]
  );

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
      <div className={styles.statsRow}>
        <StatItem
          label="Cache Hit Rate"
          value={cacheHitRate}
          unit="percent"
          loading={cacheReadStat.loading || inputTokensStat.loading}
        />
        <StatItem label="Cache Read Tokens" value={cacheReadValue} unit="short" loading={cacheReadStat.loading} />
        <StatItem label="Cache Write Tokens" value={cacheWriteValue} unit="short" loading={cacheWriteStat.loading} />
        <StatItem label="Input Tokens" value={inputTokensValue} unit="short" loading={inputTokensStat.loading} />
        <StatItem
          label="Estimated Savings"
          value={savings.savings}
          unit="currencyUSD"
          loading={cacheByModelData.loading || resolvedPricing.loading}
        />
      </div>
      <div className={styles.grid}>
        {/* Row 1: Cache hit rate over time + cache hit rate by model */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Cache hit rate by ${breakdownBy}` : 'Cache hit rate over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
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
          />
        </div>

        {/* Row 2: Cache read vs write over time + cache tokens by type */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Cache read vs write over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
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
            />
          </div>
        )}

        {/* Savings breakdown by model */}
        {savings.byModel.length > 0 && <SavingsTable items={savings.byModel} height={CHART_HEIGHT} />}
      </div>

      {/* Conversations with low cache utilization */}
      <CacheMissConversationsTable conversationsDataSource={conversationsDataSource} timeRange={timeRange} />
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
  height: number;
};

function SavingsTable({ items, height }: SavingsTableProps) {
  const styles = useStyles2(getBreakdownStatPanelStyles);
  const theme = useTheme2();
  const palette = useMemo(() => getBarPalette(theme), [theme]);
  const totalSavings = items.reduce((s, i) => s + i.savings, 0);
  return (
    <div className={styles.bspPanel} style={{ height }}>
      <div className={styles.bspHeader}>
        <span className={styles.bspTitle}>Cache savings by model</span>
        <div className={styles.bspValueRow}>
          <span className={styles.bspBigValue}>{formatStatValue(totalSavings, 'currencyUSD')}</span>
        </div>
      </div>
      <div className={styles.bspList}>
        {items.map((item) => {
          const barWidth = totalSavings > 0 ? (item.savings / items[0].savings) * 100 : 0;
          const color = palette[stringHash(`${item.provider}::${item.model}`) % palette.length];
          return (
            <div key={`${item.provider}::${item.model}`} className={styles.bspBarRow}>
              <div className={styles.bspBarMeta}>
                <span className={styles.bspBarName}>{item.model}</span>
                <span className={styles.bspBarValue}>
                  {formatStatValue(item.savings, 'currencyUSD')} · {formatStatValue(item.cacheHitRate, 'percent')} hit
                  rate
                </span>
              </div>
              <div className={styles.bspBarTrack}>
                <div className={styles.bspBarFill} style={{ width: `${barWidth}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Conversations with low cache utilization ---

const CACHE_SELECT_FIELDS = ['span.gen_ai.usage.input_tokens', 'span.gen_ai.usage.cache_read_input_tokens'];

type CacheMissConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
};

function CacheMissConversationsTable({ conversationsDataSource, timeRange }: CacheMissConversationsTableProps) {
  const styles = useStyles2(getStyles);
  const bspStyles = useStyles2(getBreakdownStatPanelStyles);
  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const versionRef = useRef(0);

  const fromISO = useMemo(() => timeRange.from.toISOString(), [timeRange.from]);
  const toISO = useMemo(() => timeRange.to.toISOString(), [timeRange.to]);

  const fetchConversations = useCallback(
    async (cursor?: string) => {
      const version = ++versionRef.current;
      if (!cursor) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError('');

      try {
        const response = await conversationsDataSource.searchConversations({
          filters: '',
          select: CACHE_SELECT_FIELDS,
          time_range: { from: fromISO, to: toISO },
          page_size: 20,
          cursor,
        });
        if (versionRef.current !== version) {
          return;
        }
        const items = response.conversations ?? [];
        setConversations((prev) => (cursor ? [...prev, ...items] : items));
        setHasMore(response.has_more);
        cursorRef.current = response.next_cursor;
      } catch (err) {
        if (versionRef.current !== version) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [conversationsDataSource, fromISO, toISO]
  );

  useEffect(() => {
    cursorRef.current = undefined;
    fetchConversations();
  }, [fetchConversations]);

  const handleLoadMore = useCallback(() => {
    if (cursorRef.current) {
      fetchConversations(cursorRef.current);
    }
  }, [fetchConversations]);

  const withCacheStats = useMemo(() => {
    return conversations
      .map((c) => {
        const inputTokens = (c.selected?.['span.gen_ai.usage.input_tokens'] as number) ?? 0;
        const cacheReadTokens = (c.selected?.['span.gen_ai.usage.cache_read_input_tokens'] as number) ?? 0;
        const total = inputTokens + cacheReadTokens;
        const cacheHitRate = total > 0 ? (cacheReadTokens / total) * 100 : 0;
        return { ...c, inputTokens, cacheReadTokens, cacheHitRate };
      })
      .sort((a, b) => a.cacheHitRate - b.cacheHitRate);
  }, [conversations]);

  const title = 'Conversations with low cache utilization';

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

  if (withCacheStats.length === 0) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={styles.emptyState}>
          <Icon name="check-circle" size="xl" />
          <Text color="secondary">No conversations found in this time range.</Text>
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
            <th className={styles.headerCell}>Input tokens</th>
            <th className={styles.headerCell}>Cache read tokens</th>
            <th className={styles.headerCell}>Cache hit rate</th>
            <th className={styles.headerCell}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {withCacheStats.map((c) => (
            <tr
              key={c.conversation_id}
              className={styles.tableRow}
              onClick={() => {
                window.location.href = `${PLUGIN_BASE}/${buildConversationDetailRoute(c.conversation_id)}`;
              }}
              role="link"
              aria-label={`view conversation ${c.conversation_id}`}
            >
              <td className={`${styles.tableCell} ${styles.idCell}`}>
                <span>{c.conversation_id}</span>
              </td>
              <td className={styles.tableCell}>{c.generation_count}</td>
              <td className={styles.tableCell}>
                <div className={styles.modelList}>
                  {c.models.map((model) => (
                    <Badge key={model} text={model} color="blue" />
                  ))}
                  {c.models.length === 0 && <Text color="secondary">-</Text>}
                </div>
              </td>
              <td className={styles.tableCell}>{formatStatValue(c.inputTokens)}</td>
              <td className={styles.tableCell}>
                {c.cacheReadTokens > 0 ? formatStatValue(c.cacheReadTokens) : <Text color="secondary">0</Text>}
              </td>
              <td className={styles.tableCell}>
                <CacheHitRateBadge rate={c.cacheHitRate} />
              </td>
              <td className={styles.tableCell}>
                <Tooltip content={new Date(c.last_generation_at).toLocaleString()} placement="left">
                  <span>{formatRelativeTime(c.last_generation_at)}</span>
                </Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasMore && (
        <div style={{ padding: 8 }}>
          {error && (
            <div className={styles.loadMoreError}>
              <Text>{error}</Text>
            </div>
          )}
          <Button
            aria-label={error ? 'retry load more' : 'load more conversations'}
            onClick={handleLoadMore}
            disabled={loadingMore}
            variant="secondary"
            fullWidth
          >
            {loadingMore ? 'Loading...' : error ? 'Retry' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
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
    loadMoreError: css({
      marginBottom: theme.spacing(1),
      color: theme.colors.error.text,
    }),
  };
}
