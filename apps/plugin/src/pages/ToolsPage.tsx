import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Alert, Icon, Input, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { defaultDashboardDataSource, type DashboardDataSource } from '../dashboard/api';
import { DashboardSummaryBar } from '../components/dashboard/DashboardSummaryBar';
import { TopStat } from '../components/TopStat';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { FilterToolbar } from '../components/filters/FilterToolbar';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import {
  computeRangeDuration,
  errorRateQuery,
  topToolErrorRateQuery,
  topToolErrorsQuery,
  topToolExecutionsQuery,
  topToolLatencyQuery,
  totalErrorsQuery,
  totalOpsQuery,
} from '../dashboard/queries';
import { buildToolAnalyticsUrl } from '../dashboard/url';
import DataTable, { type ColumnDef, getCommonCellStyles } from '../components/shared/DataTable';
import { vectorToStatValue } from '../dashboard/transforms';
import type { DashboardFilters, PrometheusQueryResponse } from '../dashboard/types';
import {
  buildExecuteToolMetricFilters,
  sanitizeToolAnalyticsFilters,
  TOOL_METRIC_LABEL,
} from '../dashboard/toolRuntime';
import { hasResponseData } from '../components/insight/summarize';

type ToolsPageProps = {
  dataSource?: DashboardDataSource;
};

type ToolSummaryRow = {
  toolName: string;
  href: string;
  executions: number;
  errors: number;
  errorRate: number;
  latencyP95: number;
};

function readToolMetricMap(response: PrometheusQueryResponse | null | undefined): Map<string, number> {
  const values = new Map<string, number>();
  if (!response || response.data.resultType !== 'vector') {
    return values;
  }

  const results = response.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
  for (const result of results) {
    const toolName = result.metric[TOOL_METRIC_LABEL];
    if (!toolName) {
      continue;
    }
    const value = Number(result.value[1]);
    if (Number.isFinite(value)) {
      values.set(toolName, value);
    }
  }

  return values;
}

function buildToolRows(
  executions: PrometheusQueryResponse | null,
  errors: PrometheusQueryResponse | null,
  errorRates: PrometheusQueryResponse | null,
  latencyP95: PrometheusQueryResponse | null,
  timeRange: TimeRange,
  filters: DashboardFilters
): ToolSummaryRow[] {
  const executionValues = readToolMetricMap(executions);
  const errorValues = readToolMetricMap(errors);
  const errorRateValues = readToolMetricMap(errorRates);
  const latencyValues = readToolMetricMap(latencyP95);

  const toolNames = new Set<string>([
    ...executionValues.keys(),
    ...errorValues.keys(),
    ...errorRateValues.keys(),
    ...latencyValues.keys(),
  ]);

  return [...toolNames]
    .map((toolName) => ({
      toolName,
      href: buildToolAnalyticsUrl(timeRange, filters, toolName),
      executions: executionValues.get(toolName) ?? 0,
      errors: errorValues.get(toolName) ?? 0,
      errorRate: errorRateValues.get(toolName) ?? 0,
      latencyP95: latencyValues.get(toolName) ?? 0,
    }))
    .sort((left, right) => {
      if (right.executions !== left.executions) {
        return right.executions - left.executions;
      }
      if (right.errors !== left.errors) {
        return right.errors - left.errors;
      }
      return left.toolName.localeCompare(right.toolName);
    });
}

export default function ToolsPage({ dataSource = defaultDashboardDataSource }: ToolsPageProps) {
  const styles = useStyles2(getStyles);
  const { timeRange, filters, searchParams, setSearchParams, setTimeRange, setFilters } = useFilterUrlState();
  const [showLabelFilterRow, setShowLabelFilterRow] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.sessionStorage.getItem(LABEL_FILTER_ROW_STORAGE_KEY) === '1';
  });
  const toolSearch = searchParams.get('tool') ?? '';
  const sanitizedFilters = useMemo(() => sanitizeToolAnalyticsFilters(filters), [filters]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.sessionStorage.setItem(LABEL_FILTER_ROW_STORAGE_KEY, showLabelFilterRow ? '1' : '0');
  }, [showLabelFilterRow]);

  useEffect(() => {
    if (filters.models.length === 0) {
      return;
    }
    setFilters(sanitizedFilters);
  }, [filters.models.length, sanitizedFilters, setFilters]);

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const metricFilters = useMemo(() => buildExecuteToolMetricFilters(sanitizedFilters), [sanitizedFilters]);

  const { providerOptions, modelOptions, agentOptions, labelKeyOptions, labelsLoading } = useCascadingFilterOptions(
    dataSource,
    sanitizedFilters,
    from,
    to
  );

  const totalExecutions = usePrometheusQuery(
    dataSource,
    totalOpsQuery(metricFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const totalErrors = usePrometheusQuery(
    dataSource,
    totalErrorsQuery(metricFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const totalErrorRate = usePrometheusQuery(
    dataSource,
    errorRateQuery(metricFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const toolExecutions = usePrometheusQuery(
    dataSource,
    topToolExecutionsQuery(sanitizedFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const toolErrors = usePrometheusQuery(
    dataSource,
    topToolErrorsQuery(sanitizedFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const toolErrorRates = usePrometheusQuery(
    dataSource,
    topToolErrorRateQuery(sanitizedFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const toolLatencyP95 = usePrometheusQuery(
    dataSource,
    topToolLatencyQuery(sanitizedFilters, rangeDuration, 0.95),
    from,
    to,
    'instant'
  );

  const rows = useMemo(
    () =>
      buildToolRows(
        toolExecutions.data,
        toolErrors.data,
        toolErrorRates.data,
        toolLatencyP95.data,
        timeRange,
        sanitizedFilters
      ),
    [sanitizedFilters, timeRange, toolErrorRates.data, toolErrors.data, toolExecutions.data, toolLatencyP95.data]
  );
  const visibleRows = useMemo(() => {
    const normalizedSearch = toolSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return rows;
    }
    return rows.filter((row) => row.toolName.toLowerCase().includes(normalizedSearch));
  }, [rows, toolSearch]);

  const pageQueryResponses = [
    totalExecutions,
    totalErrors,
    totalErrorRate,
    toolExecutions,
    toolErrors,
    toolErrorRates,
    toolLatencyP95,
  ];
  const pageIsLoading = pageQueryResponses.some((response) => response.loading);
  const pageHasErrors = pageQueryResponses.some((response) => response.error.length > 0);
  const pageHasData = rows.length > 0 || pageQueryResponses.some((response) => hasResponseData(response.data));

  const handleFiltersChange = useCallback(
    (nextFilters: DashboardFilters) => {
      setFilters(sanitizeToolAnalyticsFilters(nextFilters));
    },
    [setFilters]
  );

  const handleToolSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.currentTarget.value;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextValue.trim()) {
            next.set('tool', nextValue);
          } else {
            next.delete('tool');
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleRowClick = useCallback((row: ToolSummaryRow, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      window.open(row.href, '_blank');
      return;
    }
    window.location.href = row.href;
  }, []);

  const columns: Array<ColumnDef<ToolSummaryRow>> = useMemo(
    () => [
      {
        id: 'tool',
        header: 'Tool',
        minWidth: 240,
        cell: (row) => (
          <a href={row.href} className={styles.toolLink} onClick={(event) => event.stopPropagation()}>
            <span className={styles.monoCell}>{row.toolName}</span>
          </a>
        ),
      },
      {
        id: 'executions',
        header: 'Executions',
        align: 'right',
        cell: (row) => row.executions.toLocaleString(),
      },
      {
        id: 'errors',
        header: 'Errors',
        align: 'right',
        cell: (row) => row.errors.toLocaleString(),
      },
      {
        id: 'errorRate',
        header: 'Error rate',
        align: 'right',
        cell: (row) => `${row.errorRate.toFixed(1)}%`,
      },
      {
        id: 'latencyP95',
        header: 'P95 latency',
        align: 'right',
        cell: (row) => formatDurationSeconds(row.latencyP95),
      },
    ],
    [styles.monoCell, styles.toolLink]
  );

  return (
    <div className={styles.page}>
      <LandingTopBar
        assistantOrigin="grafana/sigil-plugin/tools"
        requestsDataSource={dataSource}
        requestsFrom={from}
        requestsTo={to}
        compact
      />

      <div className={styles.header}>
        <div>
          <Text color="secondary">Runtime analytics</Text>
          <h2 className={styles.title}>Tools</h2>
          <p className={styles.subtitle}>
            Browse tool execution volume, failures, and latency from existing `execute_tool` metrics, then open a
            tool-specific drilldown.
          </p>
        </div>
      </div>

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
        hideModelFilter
        fillWidth
        showLabelFilterRow={showLabelFilterRow}
        onLabelFilterRowOpenChange={setShowLabelFilterRow}
      >
        <Input
          prefix={<Icon name="search" />}
          value={toolSearch}
          onChange={handleToolSearchChange}
          placeholder="Filter by tool name..."
          className={styles.searchInput}
        />
      </FilterToolbar>

      <DashboardSummaryBar>
        <TopStat
          label="Tools matched"
          value={visibleRows.length}
          loading={pageIsLoading && rows.length === 0}
          helpTooltip="The number of tool names visible in the current filtered view."
        />
        <TopStat
          label="Executions"
          value={totalExecutions.data ? vectorToStatValue(totalExecutions.data) : 0}
          loading={totalExecutions.loading}
        />
        <TopStat
          label="Errors"
          value={totalErrors.data ? vectorToStatValue(totalErrors.data) : 0}
          loading={totalErrors.loading}
        />
        <TopStat
          label="Error rate"
          value={totalErrorRate.data ? vectorToStatValue(totalErrorRate.data) : 0}
          unit="percent"
          loading={totalErrorRate.loading}
        />
      </DashboardSummaryBar>

      {pageHasErrors && pageHasData && (
        <Alert severity="warning" title="Some tool analytics panels are incomplete">
          Some tool-runtime metric queries failed, so the table may be partially populated.
        </Alert>
      )}

      {!pageIsLoading && pageHasErrors && !pageHasData && (
        <Alert severity="error" title="Tools analytics failed to load">
          Every tool-runtime query failed for this page. Adjust filters or retry later.
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={visibleRows}
        keyOf={(row) => row.toolName}
        onRowClick={handleRowClick}
        rowRole="link"
        rowAriaLabel={(row) => `open tool analytics for ${row.toolName}`}
        panelTitle="Tool runtime overview"
        panelSubtitle={
          <Tooltip content="Metrics are derived from execute_tool Prometheus series grouped by tool name.">
            <span>{rows.length} tools in the selected time range</span>
          </Tooltip>
        }
        loading={pageIsLoading && rows.length === 0}
        loadError={!pageHasData && pageHasErrors ? 'Tool analytics failed to load.' : undefined}
        emptyIcon="wrench"
        emptyMessage={
          toolSearch.trim()
            ? `No tools matched "${toolSearch.trim()}" in the current filtered result set.`
            : 'No execute_tool runtime data matched the current filters.'
        }
      />
    </div>
  );
}

const LABEL_FILTER_ROW_STORAGE_KEY = 'sigil.tools.labelFilterRowOpen';

function formatDurationSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 s';
  }
  if (value < 1) {
    return `${Math.round(value * 1000)} ms`;
  }
  if (value < 60) {
    return `${value.toFixed(2)} s`;
  }
  return `${(value / 60).toFixed(1)} min`;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    ...getCommonCellStyles(theme),
    page: css({
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
      maxWidth: 760,
    }),
    searchInput: css({
      width: 320,
      maxWidth: '100%',
    }),
    toolLink: css({
      color: theme.colors.text.primary,
      textDecoration: 'none',
      '&:hover': {
        color: theme.colors.primary.main,
      },
    }),
  };
}
