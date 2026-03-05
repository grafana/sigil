import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Badge, Button, Icon, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { StatItem, BreakdownStatPanel, getBreakdownStatPanelStyles, formatRelativeTime } from './dashboardShared';
import type { DashboardDataSource } from '../../dashboard/api';
import { type BreakdownDimension, type DashboardFilters, breakdownToPromLabel } from '../../dashboard/types';
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
import { type ConversationsDataSource, defaultConversationsDataSource } from '../../conversation/api';
import type { ConversationSearchResult } from '../../conversation/types';
import { PLUGIN_BASE, buildConversationViewRoute } from '../../constants';
import { PageInsightBar } from '../insight/PageInsightBar';
import { summarizeVector, summarizeMatrix, hasResponseData } from '../insight/summarize';

export type DashboardErrorsGridProps = {
  dataSource: DashboardDataSource;
  conversationsDataSource?: ConversationsDataSource;
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

export function DashboardErrorsGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
  onTimeRangeChange,
}: DashboardErrorsGridProps) {
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

  const allDataLoading =
    topTotalErrors.loading ||
    topErrorRate.loading ||
    errorRateTimeseries.loading ||
    errorsByCodeStat.loading ||
    errorsByCodeTimeseries.loading ||
    errorRateByBreakdown.loading;

  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const hasAnyData =
      hasResponseData(topTotalErrors.data) ||
      hasResponseData(topErrorRate.data) ||
      hasResponseData(errorRateTimeseries.data) ||
      hasResponseData(errorsByCodeStat.data);
    if (!hasAnyData) {
      return null;
    }
    return [
      'Errors dashboard context:',
      `Breakdown: ${breakdownBy}`,
      '',
      summarizeVector(topTotalErrors.data, 'Total Errors'),
      summarizeVector(topErrorRate.data, 'Error Rate (%)'),
      summarizeMatrix(errorRateTimeseries.data, 'Error rate over time'),
      summarizeVector(errorsByCodeStat.data, 'Errors by code'),
      summarizeMatrix(errorsByCodeTimeseries.data, 'Errors by code over time'),
      summarizeVector(errorRateByBreakdown.data, `Error rate by ${breakdownBy}`),
    ].join('\n');
  }, [
    allDataLoading,
    breakdownBy,
    topTotalErrors.data,
    topErrorRate.data,
    errorRateTimeseries.data,
    errorsByCodeStat.data,
    errorsByCodeTimeseries.data,
    errorRateByBreakdown.data,
  ]);

  const insightPrompt = `Analyze this GenAI errors dashboard. Breakdown: ${breakdownBy}. Only flag significant findings — anomalies, outliers, error spikes, or actionable issues. Skip anything that looks normal.`;

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <div className={styles.statsRow}>
        <StatItem label="Total Errors" value={totalErrorsValue} loading={topTotalErrors.loading} />
        <StatItem label="Error Rate" value={errorRateValue} unit="percent" loading={topErrorRate.loading} />
      </div>

      <PageInsightBar
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-errors-insight"
        dataContext={insightDataContext}
        systemPrompt="You are a concise observability analyst. Return exactly 3-5 high-confidence suggestions. Include only suggestions strongly supported by the provided data; omit uncertain ideas. Each suggestion is a single short sentence on its own line prefixed with '- '. Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only."
      />

      {/* Visualizations */}
      <div className={styles.grid}>
        {/* Row 1: Error rate over time + Errors by code breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Error rate over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={errorRateTimeseries.loading}
            error={errorRateTimeseries.error}
            data={errorRateTimeseries.data ? matrixToDataFrames(errorRateTimeseries.data) : []}
            options={rateOptions}
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
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={errorsByCodeTimeseries.loading}
            error={errorsByCodeTimeseries.error}
            data={errorsByCodeTimeseries.data ? matrixToDataFrames(errorsByCodeTimeseries.data) : []}
            options={errorOptions}
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
            title={hasBreakdown ? `Error rate by ${breakdownBy}` : 'Error rate'}
            data={errorRateByBreakdown.data}
            loading={errorRateByBreakdown.loading}
            error={errorRateByBreakdown.error}
            breakdownLabel={breakdownPromLabel}
            height={CHART_HEIGHT}
            unit="percent"
            aggregation="avg"
            aggregateOverride={hasBreakdown ? errorRateValue : undefined}
          />
        </div>
      </div>

      {/* Conversations with errors */}
      <ErrorConversationsTable conversationsDataSource={conversationsDataSource} timeRange={timeRange} />
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
          <span className={bspStyles.bspTitle}>Conversations with errors</span>
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
          <span className={bspStyles.bspTitle}>Conversations with errors</span>
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
          <span className={bspStyles.bspTitle}>Conversations with errors</span>
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
        <span className={bspStyles.bspTitle}>Conversations with errors</span>
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
                window.location.href = `${PLUGIN_BASE}/${buildConversationViewRoute(conversation.conversation_id)}`;
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
