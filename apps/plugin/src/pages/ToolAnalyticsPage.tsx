import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  dateTime,
  ThresholdsMode,
  type AbsoluteTimeRange,
  type DataFrame,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import { Alert, LinkButton, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { useParams } from 'react-router-dom';
import { defaultDashboardDataSource, type DashboardDataSource } from '../dashboard/api';
import type { DashboardFilters, PrometheusQueryResponse } from '../dashboard/types';
import type { ConversationSearchResult } from '../conversation/types';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { buildConversationSearchFilter } from '../conversation/filters';
import {
  buildToolMetricFilters,
  buildToolConversationFilters,
  sanitizeToolAnalyticsFilters,
  TOOL_METRIC_LABEL,
} from '../dashboard/toolRuntime';
import { buildConversationsUrl, buildToolsUrl } from '../dashboard/url';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';
import { FilterToolbar } from '../components/filters/FilterToolbar';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { DashboardSummaryBar } from '../components/dashboard/DashboardSummaryBar';
import { TopStat } from '../components/TopStat';
import {
  computeRangeDuration,
  computeRateInterval,
  computeStep,
  errorRateOverTimeQuery,
  errorRateQuery,
  errorsByCodeStatQuery,
  latencyOverTimeQuery,
  latencyStatQuery,
  requestCountOverTimeQuery,
  totalErrorsQuery,
  totalOpsQuery,
} from '../dashboard/queries';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { MetricPanel } from '../components/dashboard/MetricPanel';
import { BreakdownStatPanel, formatRelativeTime, formatWindowLabel } from '../components/dashboard/dashboardShared';
import { matrixToDataFrames, vectorToStatValue } from '../dashboard/transforms';
import DataTable, { type ColumnDef, getCommonCellStyles } from '../components/shared/DataTable';
import { PLUGIN_BASE, buildConversationExploreRoute } from '../constants';
import { hasResponseData } from '../components/insight/summarize';

const LABEL_FILTER_ROW_STORAGE_KEY = 'sigil.toolAnalytics.labelFilterRowOpen';
const CHART_HEIGHT = 250;
const TOOL_BREAKDOWN_LABEL = 'gen_ai_agent_name';
const ERROR_TYPE_LABEL = 'error_type';
const MAX_CONVERSATION_ROWS = 10;
const EMPTY_MATRIX_RESPONSE: PrometheusQueryResponse = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [],
  },
};

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

type ToolAnalyticsPageProps = {
  dataSource?: DashboardDataSource;
  conversationsDataSource?: ConversationsDataSource;
};

function buildLatencySeriesFrames(frames: DataFrame[], label: string): DataFrame[] {
  return frames.map((frame) => {
    const valueField = frame.fields[1];
    return {
      ...frame,
      name: label,
      fields: [
        frame.fields[0],
        {
          ...valueField,
          name: label,
          config: {
            ...valueField.config,
            displayName: label,
          },
        },
      ],
    };
  });
}

type ToolConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
  toolName: string;
};

function ToolConversationsTable({
  conversationsDataSource,
  timeRange,
  filters,
  toolName,
}: ToolConversationsTableProps) {
  const styles = useStyles2(getStyles);
  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const versionRef = useRef(0);

  const conversationFilters = useMemo(() => buildToolConversationFilters(filters, toolName), [filters, toolName]);
  const filterString = useMemo(() => buildConversationSearchFilter(conversationFilters), [conversationFilters]);
  const fromISO = useMemo(() => timeRange.from.toISOString(), [timeRange.from]);
  const toISO = useMemo(() => timeRange.to.toISOString(), [timeRange.to]);

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
          page_size: MAX_CONVERSATION_ROWS,
        });

        if (versionRef.current !== version) {
          return;
        }

        setConversations(response.conversations ?? []);
      } catch (err) {
        if (versionRef.current !== version) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load tool conversations');
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
        }
      }
    })();
  }, [conversationsDataSource, filterString, fromISO, toISO]);

  const columns: Array<ColumnDef<ConversationSearchResult>> = useMemo(
    () => [
      {
        id: 'conversation',
        header: 'Conversation',
        cell: (conversation) => (
          <span className={styles.monoCell}>
            {conversation.conversation_title?.trim() || conversation.conversation_id}
          </span>
        ),
      },
      {
        id: 'agents',
        header: 'Agents',
        cell: (conversation) => (
          <span>{conversation.agents.length > 0 ? conversation.agents.join(', ') : 'Unknown agent'}</span>
        ),
      },
      {
        id: 'calls',
        header: 'LLM calls',
        cell: (conversation) => conversation.generation_count,
        align: 'right',
      },
      {
        id: 'errors',
        header: 'Errors',
        cell: (conversation) => conversation.error_count,
        align: 'right',
      },
      {
        id: 'lastActivity',
        header: 'Last activity',
        cell: (conversation) => (
          <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
            <span>{formatRelativeTime(conversation.last_generation_at)}</span>
          </Tooltip>
        ),
      },
    ],
    [styles.monoCell]
  );

  const handleRowClick = useCallback((conversation: ConversationSearchResult, event: React.MouseEvent) => {
    const route = buildConversationExploreRoute(conversation.conversation_id);
    const fullHref = `${PLUGIN_BASE}/${route}`;
    if (event.metaKey || event.ctrlKey) {
      window.open(fullHref, '_blank');
    } else {
      window.location.href = fullHref;
    }
  }, []);

  return (
    <DataTable
      columns={columns}
      data={conversations}
      keyOf={(conversation) => conversation.conversation_id}
      onRowClick={handleRowClick}
      rowRole="link"
      rowAriaLabel={(conversation) => `view conversation ${conversation.conversation_id}`}
      panelTitle="Recent conversations"
      loading={loading}
      loadError={error && conversations.length === 0 ? error : undefined}
      emptyIcon="comments-alt"
      emptyMessage="No conversations matched this tool in the selected time range."
      seeMoreHref={buildConversationsUrl(timeRange, conversationFilters, 'time')}
      seeMoreLabel="Open filtered conversations"
    />
  );
}

export default function ToolAnalyticsPage({
  dataSource = defaultDashboardDataSource,
  conversationsDataSource = defaultConversationsDataSource,
}: ToolAnalyticsPageProps) {
  const styles = useStyles2(getStyles);
  const { toolName: routeToolName } = useParams<{ toolName: string }>();
  const toolName = useMemo(() => routeToolName?.trim() ?? '', [routeToolName]);
  const { timeRange, filters, setTimeRange, setFilters } = useFilterUrlState();
  const [showLabelFilterRow, setShowLabelFilterRow] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.sessionStorage.getItem(LABEL_FILTER_ROW_STORAGE_KEY) === '1';
  });
  const sanitizedFilters = useMemo(() => sanitizeToolAnalyticsFilters(filters), [filters]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.sessionStorage.setItem(LABEL_FILTER_ROW_STORAGE_KEY, showLabelFilterRow ? '1' : '0');
  }, [showLabelFilterRow]);

  useEffect(() => {
    const hasConflictingLabels = filters.labelFilters.some((filter) => filter.key.trim() === TOOL_METRIC_LABEL);
    if (!hasConflictingLabels) {
      return;
    }
    setFilters(sanitizedFilters);
  }, [filters.labelFilters, sanitizedFilters, setFilters]);

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);
  const windowSize = useMemo(() => Math.max(0, to - from), [from, to]);
  const prevFrom = useMemo(() => Math.max(0, from - windowSize), [from, windowSize]);
  const prevTo = useMemo(() => from, [from]);
  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const prevRangeDuration = useMemo(() => computeRangeDuration(prevFrom, prevTo), [prevFrom, prevTo]);
  const comparisonLabel = useMemo(() => `previous ${formatWindowLabel(windowSize)}`, [windowSize]);

  const { providerOptions, modelOptions, agentOptions, labelKeyOptions, labelsLoading } = useCascadingFilterOptions(
    dataSource,
    sanitizedFilters,
    from,
    to
  );

  const metricFilters = useMemo(() => buildToolMetricFilters(sanitizedFilters, toolName), [sanitizedFilters, toolName]);
  const conversationFilters = useMemo(
    () => buildToolConversationFilters(sanitizedFilters, toolName),
    [sanitizedFilters, toolName]
  );

  const executions = usePrometheusQuery(dataSource, totalOpsQuery(metricFilters, rangeDuration), from, to, 'instant');
  const totalErrors = usePrometheusQuery(
    dataSource,
    totalErrorsQuery(metricFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const errorRate = usePrometheusQuery(dataSource, errorRateQuery(metricFilters, rangeDuration), from, to, 'instant');
  const latencyP50 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, rangeDuration, 'none', 0.5),
    from,
    to,
    'instant'
  );
  const latencyP95 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );
  const latencyP99 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, rangeDuration, 'none', 0.99),
    from,
    to,
    'instant'
  );
  const prevExecutions = usePrometheusQuery(
    dataSource,
    totalOpsQuery(metricFilters, prevRangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevTotalErrors = usePrometheusQuery(
    dataSource,
    totalErrorsQuery(metricFilters, prevRangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevErrorRate = usePrometheusQuery(
    dataSource,
    errorRateQuery(metricFilters, prevRangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevLatencyP50 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, prevRangeDuration, 'none', 0.5),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevLatencyP95 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, prevRangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevLatencyP99 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, prevRangeDuration, 'none', 0.99),
    prevFrom,
    prevTo,
    'instant'
  );

  const usageOverTime = usePrometheusQuery(
    dataSource,
    requestCountOverTimeQuery(metricFilters, `${step}s`, 'none'),
    from,
    to,
    'range',
    step
  );
  const errorRateOverTime = usePrometheusQuery(
    dataSource,
    errorRateOverTimeQuery(metricFilters, interval, 'none'),
    from,
    to,
    'range',
    step
  );
  const latencyP50OverTime = usePrometheusQuery(
    dataSource,
    latencyOverTimeQuery(metricFilters, interval, 'none', 0.5),
    from,
    to,
    'range',
    step
  );
  const latencyP95OverTime = usePrometheusQuery(
    dataSource,
    latencyOverTimeQuery(metricFilters, interval, 'none', 0.95),
    from,
    to,
    'range',
    step
  );
  const latencyP99OverTime = usePrometheusQuery(
    dataSource,
    latencyOverTimeQuery(metricFilters, interval, 'none', 0.99),
    from,
    to,
    'range',
    step
  );
  const topAgents = usePrometheusQuery(
    dataSource,
    totalOpsQuery(metricFilters, rangeDuration, 'agent'),
    from,
    to,
    'instant'
  );
  const topErrorTypes = usePrometheusQuery(
    dataSource,
    errorsByCodeStatQuery(metricFilters, rangeDuration),
    from,
    to,
    'instant'
  );

  const handlePanelTimeRangeChange = useCallback(
    (absoluteRange: AbsoluteTimeRange) => {
      const nextFrom = dateTime(absoluteRange.from);
      const nextTo = dateTime(absoluteRange.to);
      setTimeRange({ from: nextFrom, to: nextTo, raw: { from: nextFrom.toISOString(), to: nextTo.toISOString() } });
    },
    [setTimeRange]
  );

  const handleFiltersChange = useCallback(
    (nextFilters: DashboardFilters) => {
      setFilters(sanitizeToolAnalyticsFilters(nextFilters));
    },
    [setFilters]
  );

  const latencyFrames = useMemo(
    () => [
      ...buildLatencySeriesFrames(matrixToDataFrames(latencyP50OverTime.data ?? EMPTY_MATRIX_RESPONSE), 'P50'),
      ...buildLatencySeriesFrames(matrixToDataFrames(latencyP95OverTime.data ?? EMPTY_MATRIX_RESPONSE), 'P95'),
      ...buildLatencySeriesFrames(matrixToDataFrames(latencyP99OverTime.data ?? EMPTY_MATRIX_RESPONSE), 'P99'),
    ],
    [latencyP50OverTime.data, latencyP95OverTime.data, latencyP99OverTime.data]
  );

  const pageQueryResponses = [
    executions,
    totalErrors,
    errorRate,
    latencyP50,
    latencyP95,
    latencyP99,
    usageOverTime,
    errorRateOverTime,
    latencyP50OverTime,
    latencyP95OverTime,
    latencyP99OverTime,
    prevExecutions,
    prevTotalErrors,
    prevErrorRate,
    prevLatencyP50,
    prevLatencyP95,
    prevLatencyP99,
    topAgents,
    topErrorTypes,
  ];
  const pageIsLoading = pageQueryResponses.some((response) => response.loading);
  const pageHasErrors = pageQueryResponses.some((response) => response.error.length > 0);
  const pageHasData = pageQueryResponses.some((response) => hasResponseData(response.data));

  if (!toolName) {
    return (
      <div className={styles.container}>
        <Alert severity="error" title="Tool not found">
          The tool name route parameter is missing.
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <LandingTopBar
        assistantOrigin="grafana/sigil-plugin/tool-analytics"
        requestsDataSource={dataSource}
        requestsFrom={from}
        requestsTo={to}
        compact
      />
      <FilterToolbar
        timeRange={timeRange}
        filters={sanitizedFilters}
        providerOptions={providerOptions}
        modelOptions={modelOptions}
        agentOptions={agentOptions}
        labelKeyOptions={labelKeyOptions}
        labelsLoading={labelsLoading}
        dataSource={dataSource}
        from={from}
        to={to}
        onTimeRangeChange={setTimeRange}
        onFiltersChange={handleFiltersChange}
        fillWidth
        showLabelFilterRow={showLabelFilterRow}
        onLabelFilterRowOpenChange={setShowLabelFilterRow}
      />
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{toolName}</h2>
          <p className={styles.subtitle}>
            Track execution volume, failures, and latency for this tool, then jump into the conversations using it.
          </p>
        </div>
        <Stack direction="row" gap={1} wrap="wrap">
          <LinkButton href={buildToolsUrl(timeRange, sanitizedFilters)} variant="secondary" size="sm">
            Back to tools
          </LinkButton>
          <LinkButton href={buildConversationsUrl(timeRange, conversationFilters, 'time')} variant="primary" size="sm">
            Open filtered conversations
          </LinkButton>
        </Stack>
      </div>
      <DashboardSummaryBar>
        <TopStat
          label="Executions"
          value={executions.data ? vectorToStatValue(executions.data) : 0}
          displayValue={formatCount(executions.data ? vectorToStatValue(executions.data) : 0)}
          loading={executions.loading}
          prevValue={prevExecutions.data ? vectorToStatValue(prevExecutions.data) : 0}
          prevLoading={prevExecutions.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Errors"
          value={totalErrors.data ? vectorToStatValue(totalErrors.data) : 0}
          displayValue={formatCount(totalErrors.data ? vectorToStatValue(totalErrors.data) : 0)}
          loading={totalErrors.loading}
          prevValue={prevTotalErrors.data ? vectorToStatValue(prevTotalErrors.data) : 0}
          prevLoading={prevTotalErrors.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Error rate"
          value={errorRate.data ? vectorToStatValue(errorRate.data) : 0}
          unit="percent"
          loading={errorRate.loading}
          prevValue={prevErrorRate.data ? vectorToStatValue(prevErrorRate.data) : 0}
          prevLoading={prevErrorRate.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Latency (P50)"
          value={latencyP50.data ? vectorToStatValue(latencyP50.data) : 0}
          unit="s"
          loading={latencyP50.loading}
          prevValue={prevLatencyP50.data ? vectorToStatValue(prevLatencyP50.data) : 0}
          prevLoading={prevLatencyP50.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Latency (P95)"
          value={latencyP95.data ? vectorToStatValue(latencyP95.data) : 0}
          unit="s"
          loading={latencyP95.loading}
          prevValue={prevLatencyP95.data ? vectorToStatValue(prevLatencyP95.data) : 0}
          prevLoading={prevLatencyP95.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Latency (P99)"
          value={latencyP99.data ? vectorToStatValue(latencyP99.data) : 0}
          unit="s"
          loading={latencyP99.loading}
          prevValue={prevLatencyP99.data ? vectorToStatValue(prevLatencyP99.data) : 0}
          prevLoading={prevLatencyP99.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
      </DashboardSummaryBar>

      {pageHasErrors && pageHasData && (
        <Alert severity="warning" title="Some tool analytics panels are incomplete">
          Some metric queries failed for this tool. Remaining results are still shown below.
        </Alert>
      )}

      {!pageIsLoading && pageHasErrors && !pageHasData && (
        <Alert severity="error" title="Tool analytics failed to load">
          Every tool-runtime query failed for this page. Adjust filters or retry later.
        </Alert>
      )}

      {!pageIsLoading && !pageHasErrors && !pageHasData && (
        <div className={styles.emptyState}>
          <Text color="secondary">No `execute_tool` runtime data matched {toolName} in this time range.</Text>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.panelRow}>
          <MetricPanel
            title="Usage volume"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={usageOverTime.loading}
            error={usageOverTime.error}
            data={usageOverTime.data ? matrixToDataFrames(usageOverTime.data) : []}
            options={{
              legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
              tooltip: { mode: 'multi', sort: 'desc' },
            }}
            fieldConfig={{
              defaults: {
                unit: 'short',
                color: consistentColor,
                custom: { fillOpacity: 6, showPoints: 'never', lineWidth: 2 },
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title="Top agents"
            data={topAgents.data}
            loading={topAgents.loading}
            error={topAgents.error}
            breakdownLabel={TOOL_BREAKDOWN_LABEL}
            height={CHART_HEIGHT}
          />
        </div>
        <div className={styles.panelRow}>
          <MetricPanel
            title="Error rate"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={errorRateOverTime.loading}
            error={errorRateOverTime.error}
            data={errorRateOverTime.data ? matrixToDataFrames(errorRateOverTime.data) : []}
            options={{
              legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
              tooltip: { mode: 'multi', sort: 'desc' },
            }}
            fieldConfig={{
              defaults: {
                unit: 'percent',
                min: 0,
                color: consistentColor,
                custom: { fillOpacity: 6, showPoints: 'never', lineWidth: 2 },
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title="Error types"
            data={topErrorTypes.data}
            loading={topErrorTypes.loading}
            error={topErrorTypes.error}
            breakdownLabel={ERROR_TYPE_LABEL}
            height={CHART_HEIGHT}
          />
        </div>
        <MetricPanel
          title="Latency distribution"
          pluginId="timeseries"
          height={CHART_HEIGHT}
          timeRange={timeRange}
          onChangeTimeRange={handlePanelTimeRangeChange}
          loading={latencyP50OverTime.loading || latencyP95OverTime.loading || latencyP99OverTime.loading}
          error={latencyP50OverTime.error || latencyP95OverTime.error || latencyP99OverTime.error}
          data={latencyFrames}
          options={{
            legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
            tooltip: { mode: 'multi', sort: 'desc' },
          }}
          fieldConfig={{
            defaults: {
              unit: 's',
              color: consistentColor,
              custom: { fillOpacity: 6, showPoints: 'never', lineWidth: 2 },
              thresholds: noThresholds,
            },
            overrides: [],
          }}
        />
      </div>

      <ToolConversationsTable
        conversationsDataSource={conversationsDataSource}
        timeRange={timeRange}
        filters={sanitizedFilters}
        toolName={toolName}
      />
    </div>
  );
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
}

function getStyles(theme: GrafanaTheme2) {
  return {
    ...getCommonCellStyles(theme),
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
      marginTop: theme.spacing(-2),
    }),
    header: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing(2),
      flexWrap: 'wrap',
    }),
    title: css({
      margin: theme.spacing(0.5, 0),
      fontSize: theme.typography.h2.fontSize,
      lineHeight: 1.1,
    }),
    subtitle: css({
      margin: 0,
      color: theme.colors.text.secondary,
      maxWidth: 720,
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
      '@media (max-width: 900px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    emptyState: css({
      padding: theme.spacing(4, 2),
      border: `1px dashed ${theme.colors.border.weak}`,
      textAlign: 'center',
    }),
  };
}
