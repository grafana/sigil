import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  ThresholdsMode,
  getValueFormat,
  formattedValueToString,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import { Badge, Button, Icon, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  breakdownToPromLabel,
  type PrometheusQueryResponse,
} from '../../dashboard/types';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalErrorsQuery,
  errorRateQuery,
  errorRateOverTimeQuery,
  errorsByCodeOverTimeQuery,
  errorsByCodeStatQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import {
  type ConversationsDataSource,
  defaultConversationsDataSource,
} from '../../conversation/api';
import type { ConversationSearchResult } from '../../conversation/types';
import { PLUGIN_BASE, buildConversationDetailRoute } from '../../constants';

export type DashboardErrorsGridProps = {
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

export function DashboardErrorsGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
}: DashboardErrorsGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  // --- Top stats ---
  const topTotalErrors = usePrometheusQuery(dataSource, totalErrorsQuery(filters, rangeDuration), from, to, 'instant');
  const topErrorRate = usePrometheusQuery(dataSource, errorRateQuery(filters, rangeDuration), from, to, 'instant');

  // --- Error rate over time ---
  const errorRateTimeseries = usePrometheusQuery(
    dataSource,
    errorRateOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Errors by code (instant for breakdown stat) ---
  const errorsByCodeStat = usePrometheusQuery(
    dataSource,
    errorsByCodeStatQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );

  // --- Errors by code over time ---
  const errorsByCodeTimeseries = usePrometheusQuery(
    dataSource,
    errorsByCodeOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Error rate by breakdown (instant) ---
  const errorRateByBreakdown = usePrometheusQuery(
    dataSource,
    errorRateQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const errorOptions = {
    legend: { displayMode: 'table', placement: 'right', calcs: ['mean'], maxWidth: 280 },
    tooltip: tooltipOptions,
  };
  const rateOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };

  const totalErrorsValue = topTotalErrors.data ? vectorToStatValue(topTotalErrors.data) : 0;
  const errorRateValue = topErrorRate.data ? vectorToStatValue(topErrorRate.data) : 0;

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <div className={styles.statsRow}>
        <div className={styles.topStat}>
          <span className={styles.topStatLabel}>Total Errors</span>
          <span className={styles.topStatValue}>
            {topTotalErrors.loading ? '–' : formatStatValue(totalErrorsValue)}
          </span>
        </div>
        <div className={styles.topStat}>
          <span className={styles.topStatLabel}>Error Rate</span>
          <span className={styles.topStatValue}>
            {topErrorRate.loading ? '–' : formatStatValue(errorRateValue, 'percent')}
          </span>
        </div>
      </div>

      {/* Visualizations */}
      <div className={styles.grid}>
        {/* Row 1: Error rate over time + Errors by code breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Error rate over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={errorRateTimeseries.loading}
            error={errorRateTimeseries.error}
            data={errorRateTimeseries.data ? matrixToDataFrames(errorRateTimeseries.data) : []}
            options={rateOptions}
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
          <BreakdownStatPanel
            title="Errors by code"
            data={errorsByCodeStat.data}
            loading={errorsByCodeStat.loading}
            error={errorsByCodeStat.error}
            breakdownLabel="error_type"
            height={CHART_HEIGHT}
          />
        </div>

        {/* Row 2: Errors by code over time + Error rate by breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Errors by code over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={errorsByCodeTimeseries.loading}
            error={errorsByCodeTimeseries.error}
            data={errorsByCodeTimeseries.data ? matrixToDataFrames(errorsByCodeTimeseries.data) : []}
            options={errorOptions}
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
            title={hasBreakdown ? `Error rate by ${breakdownBy}` : 'Error rate'}
            data={errorRateByBreakdown.data}
            loading={errorRateByBreakdown.loading}
            error={errorRateByBreakdown.error}
            breakdownLabel={breakdownPromLabel}
            height={CHART_HEIGHT}
            unit="percent"
            aggregation="avg"
          />
        </div>
      </div>

      {/* Conversations with errors */}
      <ErrorConversationsTable
        conversationsDataSource={conversationsDataSource}
        timeRange={timeRange}
      />
    </div>
  );
}

function formatStatValue(value: number, unit?: string): string {
  const fmt = getValueFormat(unit ?? 'short');
  return formattedValueToString(fmt(value));
}

// --- BreakdownStatPanel (simplified version for error breakdowns) ---

type BreakdownStatPanelProps = {
  title: string;
  data: PrometheusQueryResponse | null | undefined;
  loading: boolean;
  error?: string;
  breakdownLabel?: string;
  height: number;
  unit?: string;
  aggregation?: 'sum' | 'avg';
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
}: BreakdownStatPanelProps) {
  const styles = useStyles2(getStyles);

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
        return { name, value: parseFloat(r.value[1]) };
      })
      .filter((r) => isFinite(r.value))
      .sort((a, b) => b.value - a.value);
  }, [data, breakdownLabel]);

  const aggregate = useMemo(() => {
    if (items.length === 0) {
      return 0;
    }
    const total = items.reduce((s, v) => s + v.value, 0);
    return aggregation === 'avg' ? total / items.length : total;
  }, [items, aggregation]);

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
            {items[0].name !== 'unknown' && <div className={styles.bspSingleLabel}>{items[0].name}</div>}
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
                <span className={styles.bspBarName}>{item.name}</span>
                <span className={styles.bspBarValue}>{formatVal(item.value)}</span>
              </div>
              <div className={styles.bspBarTrack}>
                <div className={styles.bspBarFill} style={{ width: `${barWidth}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Conversations with errors table ---

type ErrorConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
};

function ErrorConversationsTable({ conversationsDataSource, timeRange }: ErrorConversationsTableProps) {
  const styles = useStyles2(getStyles);
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
          filters: 'status = error',
          select: [],
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

  if (loading) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={styles.bspTitle}>Conversations with errors</span>
        </div>
        <div className={styles.bspCenter} style={{ padding: 32 }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={styles.bspTitle}>Conversations with errors</span>
        </div>
        <div className={styles.bspCenter} style={{ padding: 32, opacity: 0.6 }}>
          {error}
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={styles.bspTitle}>Conversations with errors</span>
        </div>
        <div className={styles.emptyState}>
          <Icon name="check-circle" size="xl" />
          <Text color="secondary">No conversations with errors in this time range.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tablePanel}>
      <div className={styles.tablePanelHeader}>
        <span className={styles.bspTitle}>Conversations with errors</span>
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
              onClick={() => {
                window.location.href = `${PLUGIN_BASE}/${buildConversationDetailRoute(conversation.conversation_id)}`;
              }}
              role="link"
              aria-label={`view conversation ${conversation.conversation_id}`}
            >
              <td className={`${styles.tableCell} ${styles.idCell}`}>
                <span>{conversation.conversation_id}</span>
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

      {hasMore && (
        <div style={{ padding: 8 }}>
          <Button
            aria-label="load more conversations"
            onClick={handleLoadMore}
            disabled={loadingMore}
            variant="secondary"
            fullWidth
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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
    topStatValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
    }),
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
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
      background: theme.colors.error.main,
    }),
    bspSingleLabel: css({
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
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
  };
}
