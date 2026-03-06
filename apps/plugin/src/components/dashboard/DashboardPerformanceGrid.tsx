import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Badge, Icon, LinkButton, Select, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type LatencyPercentile,
  breakdownToPromLabel,
} from '../../dashboard/types';
import {
  BreakdownStatPanel,
  formatWindowLabel,
  getBreakdownStatPanelStyles,
  formatRelativeTime,
} from './dashboardShared';
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
import { type ConversationsDataSource, defaultConversationsDataSource } from '../../conversation/api';
import { buildConversationSearchFilter } from '../../conversation/filters';
import type { ConversationSearchResult } from '../../conversation/types';
import { PLUGIN_BASE, ROUTES, buildConversationExploreRoute } from '../../constants';
import { formatDuration } from '../conversations/ConversationListPanel';
import { ViewConversationsLink } from './ViewConversationsLink';
import { ViewAgentsLink, buildAgentDetailHref } from './ViewAgentsLink';
import { useModelCardBreakdownPopover } from './useModelCardBreakdownPopover';
import { PageInsightBar } from '../insight/PageInsightBar';
import { summarizeVector, summarizeMatrix, hasResponseData } from '../insight/summarize';
import { DashboardSummaryBar } from './DashboardSummaryBar';

export type DashboardPerformanceGridProps = {
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
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
  onTimeRangeChange,
}: DashboardPerformanceGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;
  const agentItemHref = useMemo(() => (breakdownBy === 'agent' ? buildAgentDetailHref : undefined), [breakdownBy]);
  const [latencyPercentile, setLatencyPercentile] = useState<LatencyPercentile>('p95');

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

  // --- Previous period comparison (shifted back by the selected window size) ---
  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
  const prevLatencyP50 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.5),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevLatencyP95 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevLatencyP99 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, 'none', 0.99),
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
    latencyStatQuery(filters, rangeDuration, breakdownBy, quantile),
    from,
    to,
    'instant'
  );

  const { onModelClick, modelPopoverElement } = useModelCardBreakdownPopover(breakdownBy, latencyStat.data);

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
    ttftStatQuery(filters, rangeDuration, breakdownBy, quantile),
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

  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;

  const latencyP50Value = latencyP50.data ? vectorToStatValue(latencyP50.data) : 0;
  const latencyP95Value = latencyP95.data ? vectorToStatValue(latencyP95.data) : 0;
  const latencyP99Value = latencyP99.data ? vectorToStatValue(latencyP99.data) : 0;
  const ttftP95Value = ttftP95.data ? vectorToStatValue(ttftP95.data) : 0;

  const prevLatencyP50Value = prevLatencyP50.data ? vectorToStatValue(prevLatencyP50.data) : 0;
  const prevLatencyP95Value = prevLatencyP95.data ? vectorToStatValue(prevLatencyP95.data) : 0;
  const prevLatencyP99Value = prevLatencyP99.data ? vectorToStatValue(prevLatencyP99.data) : 0;
  const prevTtftP95Value = prevTtftP95.data ? vectorToStatValue(prevTtftP95.data) : 0;

  return (
    <div className={styles.gridWrapper}>
      <DashboardSummaryBar>
        <TopStat
          label="Latency (P50)"
          value={latencyP50Value}
          unit="s"
          loading={latencyP50.loading}
          prevValue={prevLatencyP50Value}
          prevLoading={prevLatencyP50.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Latency (P95)"
          value={latencyP95Value}
          unit="s"
          loading={latencyP95.loading}
          prevValue={prevLatencyP95Value}
          prevLoading={prevLatencyP95.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Latency (P99)"
          value={latencyP99Value}
          unit="s"
          loading={latencyP99.loading}
          prevValue={prevLatencyP99Value}
          prevLoading={prevLatencyP99.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Time to First Token (P95)"
          value={ttftP95Value}
          unit="s"
          loading={ttftP95.loading}
          prevValue={prevTtftP95Value}
          prevLoading={prevTtftP95.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
      </DashboardSummaryBar>
      <PageInsightBar
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-performance-insight"
        dataContext={insightDataContext}
        systemPrompt="You are a concise observability analyst. Return exactly 3-5 high-confidence suggestions. Include only suggestions strongly supported by the provided data; omit uncertain ideas. Each suggestion is a single short sentence on its own line prefixed with '- '. Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only."
      />

      <div className={styles.grid}>
        {/* Row 1: Latency over time */}
        <div className={styles.panelRowWithStat}>
          <MetricPanel
            title="Latency"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
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
            actions={
              <>
                {breakdownBy === 'agent' && <ViewAgentsLink />}
                <ViewConversationsLink timeRange={timeRange} filters={filters} orderBy="duration" />
              </>
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
            getItemHref={agentItemHref}
            onItemClick={onModelClick}
          />
        </div>

        {/* Row 2: Time to First Token */}
        <div className={styles.panelRowWithStat}>
          <MetricPanel
            title="Time to First Token"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
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
          <BreakdownStatPanel
            title={`Avg TTFT (${latencyPercentile.toUpperCase()})`}
            data={ttftStat.data}
            loading={ttftStat.loading}
            error={ttftStat.error}
            breakdownLabel={breakdownPromLabel}
            height={CHART_HEIGHT}
            unit="s"
            aggregation="avg"
            getItemHref={agentItemHref}
            onItemClick={onModelClick}
          />
        </div>
      </div>

      <HighestLatencyConversationsTable
        conversationsDataSource={conversationsDataSource}
        timeRange={timeRange}
        filters={filters}
      />
      {modelPopoverElement}
    </div>
  );
}

// --- Highest latency conversations table ---

const MAX_LATENCY_ROWS = 10;

type HighestLatencyTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
};

function buildSeeMoreUrl(timeRange: TimeRange, filters: DashboardFilters): string {
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
  params.set('orderBy', 'duration');
  return `${PLUGIN_BASE}/${ROUTES.Conversations}?${params.toString()}`;
}

function HighestLatencyConversationsTable({ conversationsDataSource, timeRange, filters }: HighestLatencyTableProps) {
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
            select: [],
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

        all.sort((a, b) => {
          const aDur = Date.parse(a.last_generation_at) - Date.parse(a.first_generation_at);
          const bDur = Date.parse(b.last_generation_at) - Date.parse(b.first_generation_at);
          return bDur - aDur;
        });

        setConversations(all.slice(0, MAX_LATENCY_ROWS));
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

  const title = 'Longest conversations';
  const seeMoreHref = buildSeeMoreUrl(timeRange, filters);

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
          <Icon name="clock-nine" size="xl" />
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
            <th className={styles.headerCell}>Duration</th>
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
              <td className={styles.tableCell}>
                {formatDuration(conversation.first_generation_at, conversation.last_generation_at)}
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
    panelRowWithStat: css({
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
    seeMoreFooter: css({
      display: 'flex',
      justifyContent: 'center',
      padding: theme.spacing(1),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
  };
}
