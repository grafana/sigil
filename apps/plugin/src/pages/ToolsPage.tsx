import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, Input, useStyles2 } from '@grafana/ui';
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
import DataTable, { type ColumnDef, getCommonCellStyles } from '../components/shared/DataTable';
import { vectorToStatValue } from '../dashboard/transforms';
import type { DashboardFilters } from '../dashboard/types';
import {
  buildExecuteToolMetricFilters,
  sanitizeToolAnalyticsFilters,
  TOOL_METRIC_LABEL,
} from '../dashboard/toolRuntime';
import {
  buildToolRows,
  formatToolCount,
  formatToolDurationSeconds,
  readToolMetricMap,
  type ToolSummaryRow,
} from '../dashboard/toolRuntimeTable';
import { hasResponseData } from '../components/insight/summarize';
import { formatWindowLabel } from '../components/dashboard/dashboardShared';

type ToolsPageProps = {
  dataSource?: DashboardDataSource;
};

type ToolSortKey = 'toolName' | 'executions' | 'errors' | 'errorRate' | 'latencyP95';
type ToolSortDirection = 'asc' | 'desc';

export default function ToolsPage({ dataSource = defaultDashboardDataSource }: ToolsPageProps) {
  const styles = useStyles2(getStyles);
  const { timeRange, filters, searchParams, setSearchParams, setTimeRange, setFilters } = useFilterUrlState();
  const [sortKey, setSortKey] = useState<ToolSortKey>('executions');
  const [sortDirection, setSortDirection] = useState<ToolSortDirection>('desc');
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
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const prevRangeDuration = useMemo(() => computeRangeDuration(prevFrom, prevTo), [prevFrom, prevTo]);
  const metricFilters = useMemo(() => buildExecuteToolMetricFilters(sanitizedFilters), [sanitizedFilters]);
  const comparisonLabel = useMemo(() => `previous ${formatWindowLabel(windowSize)}`, [windowSize]);

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
  const prevTotalExecutions = usePrometheusQuery(
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
  const prevTotalErrorRate = usePrometheusQuery(
    dataSource,
    errorRateQuery(metricFilters, prevRangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevToolExecutions = usePrometheusQuery(
    dataSource,
    topToolExecutionsQuery(sanitizedFilters, prevRangeDuration),
    prevFrom,
    prevTo,
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
  const sortedRows = useMemo(() => {
    const directionFactor = sortDirection === 'asc' ? 1 : -1;
    return [...visibleRows].sort((left, right) => {
      let comparison = 0;
      switch (sortKey) {
        case 'toolName':
          comparison = left.toolName.localeCompare(right.toolName);
          break;
        case 'executions':
          comparison = left.executions - right.executions;
          break;
        case 'errors':
          comparison = left.errors - right.errors;
          break;
        case 'errorRate':
          comparison = left.errorRate - right.errorRate;
          break;
        case 'latencyP95':
          comparison = left.latencyP95 - right.latencyP95;
          break;
      }
      if (comparison !== 0) {
        return comparison * directionFactor;
      }
      return left.toolName.localeCompare(right.toolName);
    });
  }, [sortDirection, sortKey, visibleRows]);

  const pageQueryResponses = [
    totalExecutions,
    totalErrors,
    totalErrorRate,
    toolExecutions,
    toolErrors,
    toolErrorRates,
    toolLatencyP95,
    prevTotalExecutions,
    prevTotalErrors,
    prevTotalErrorRate,
    prevToolExecutions,
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

  const handleSortChange = useCallback(
    (nextKey: ToolSortKey) => {
      if (nextKey === sortKey) {
        setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
        return;
      }
      setSortKey(nextKey);
      setSortDirection(nextKey === 'toolName' ? 'asc' : 'desc');
    },
    [sortKey]
  );

  const buildSortableHeader = useCallback(
    (label: string, key: ToolSortKey) => {
      const isActive = sortKey === key;
      const iconName = isActive ? (sortDirection === 'desc' ? 'arrow-down' : 'arrow-up') : 'arrows-v';
      const ariaSort = isActive ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none';
      const alignRight = key !== 'toolName';

      return (
        <button
          type="button"
          className={`${styles.sortButtonBase} ${alignRight ? styles.sortButtonRight : styles.sortButtonLeft}`}
          onClick={() => handleSortChange(key)}
          aria-label={`Sort by ${label.toLowerCase()} ${ariaSort}`}
        >
          <span>{label}</span>
          <Icon name={iconName} size="sm" />
        </button>
      );
    },
    [handleSortChange, sortDirection, sortKey, styles.sortButtonBase, styles.sortButtonLeft, styles.sortButtonRight]
  );

  const columns: Array<ColumnDef<ToolSummaryRow>> = useMemo(
    () => [
      {
        id: 'tool',
        header: buildSortableHeader('Tool', 'toolName'),
        minWidth: 240,
        cell: (row) => (
          <a href={row.href} className={styles.toolLink} onClick={(event) => event.stopPropagation()}>
            <span className={styles.monoCell}>{row.toolName}</span>
          </a>
        ),
      },
      {
        id: 'executions',
        header: buildSortableHeader('Executions', 'executions'),
        align: 'right',
        cell: (row) => formatToolCount(row.executions),
      },
      {
        id: 'errors',
        header: buildSortableHeader('Errors', 'errors'),
        align: 'right',
        cell: (row) => formatToolCount(row.errors),
      },
      {
        id: 'errorRate',
        header: buildSortableHeader('Error rate', 'errorRate'),
        align: 'right',
        cell: (row) => `${row.errorRate.toFixed(1)}%`,
      },
      {
        id: 'latencyP95',
        header: buildSortableHeader('P95 latency', 'latencyP95'),
        align: 'right',
        cell: (row) => formatToolDurationSeconds(row.latencyP95),
      },
    ],
    [buildSortableHeader, styles.monoCell, styles.toolLink]
  );

  const totalExecutionsValue = totalExecutions.data ? vectorToStatValue(totalExecutions.data) : 0;
  const totalErrorsValue = totalErrors.data ? vectorToStatValue(totalErrors.data) : 0;
  const totalErrorRateValue = totalErrorRate.data ? vectorToStatValue(totalErrorRate.data) : 0;
  const prevTotalExecutionsValue = prevTotalExecutions.data ? vectorToStatValue(prevTotalExecutions.data) : 0;
  const prevTotalErrorsValue = prevTotalErrors.data ? vectorToStatValue(prevTotalErrors.data) : 0;
  const prevTotalErrorRateValue = prevTotalErrorRate.data ? vectorToStatValue(prevTotalErrorRate.data) : 0;
  const prevToolsMatchedValue = prevToolExecutions.data ? readToolMetricMap(prevToolExecutions.data).size : 0;

  return (
    <div className={styles.page}>
      <LandingTopBar
        assistantOrigin="grafana/sigil-plugin/tools"
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
      >
        <Input
          prefix={<Icon name="search" />}
          value={toolSearch}
          onChange={handleToolSearchChange}
          placeholder="Filter by tool name..."
          className={styles.searchInput}
        />
      </FilterToolbar>

      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Tools</h2>
          <p className={styles.subtitle}>
            Compare tool usage, failures, and latency, then open a tool to inspect its runtime activity in detail.
          </p>
        </div>
      </div>

      <DashboardSummaryBar>
        <TopStat
          label="Tools matched"
          value={visibleRows.length}
          prevValue={prevToolsMatchedValue}
          prevLoading={prevToolExecutions.loading}
          comparisonLabel={comparisonLabel}
          loading={pageIsLoading && rows.length === 0}
          helpTooltip="The number of tool names visible in the current filtered view."
        />
        <TopStat
          label="Executions"
          value={totalExecutionsValue}
          displayValue={formatToolCount(totalExecutionsValue)}
          loading={totalExecutions.loading}
          prevValue={prevTotalExecutionsValue}
          prevLoading={prevTotalExecutions.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Errors"
          value={totalErrorsValue}
          displayValue={formatToolCount(totalErrorsValue)}
          loading={totalErrors.loading}
          prevValue={prevTotalErrorsValue}
          prevLoading={prevTotalErrors.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Error rate"
          value={totalErrorRateValue}
          unit="percent"
          loading={totalErrorRate.loading}
          prevValue={prevTotalErrorRateValue}
          prevLoading={prevTotalErrorRate.loading}
          invertChange
          comparisonLabel={comparisonLabel}
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
        data={sortedRows}
        keyOf={(row) => row.toolName}
        onRowClick={handleRowClick}
        rowRole="link"
        rowAriaLabel={(row) => `open tool analytics for ${row.toolName}`}
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
    sortButtonBase: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      width: '100%',
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
    sortButtonLeft: css({
      label: 'toolsPage-sortButtonLeft',
      justifyContent: 'flex-start',
    }),
    sortButtonRight: css({
      label: 'toolsPage-sortButtonRight',
      justifyContent: 'flex-end',
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
