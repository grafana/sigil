import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Alert, Icon, useStyles2 } from '@grafana/ui';
import { TopStat } from '../TopStat';
import { DashboardSummaryBar } from './DashboardSummaryBar';
import { usePrometheusQuery } from './usePrometheusQuery';
import DataTable, { type ColumnDef, getCommonCellStyles } from '../shared/DataTable';
import { hasResponseData } from '../insight/summarize';
import type { DashboardDataSource } from '../../dashboard/api';
import type { BreakdownDimension, DashboardFilters } from '../../dashboard/types';
import {
  buildExecuteToolMetricFilters,
  normalizeToolAnalyticsBreakdown,
  resolveToolAnalyticsStatBreakdown,
  sanitizeToolAnalyticsFilters,
  TOOL_METRIC_LABEL,
} from '../../dashboard/toolRuntime';
import {
  buildToolRows,
  formatToolCount,
  formatToolDurationSeconds,
  readToolMetricMap,
  type ToolSummaryRow,
} from '../../dashboard/toolRuntimeTable';
import { buildToolsUrl } from '../../dashboard/url';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { BreakdownStatPanel, formatWindowLabel } from './dashboardShared';
import {
  computeRangeDuration,
  computeRateInterval,
  computeStep,
  errorRateOverTimeQuery,
  errorRateQuery,
  latencyStatQuery,
  latencyOverTimeQuery,
  requestCountOverTimeQuery,
  topToolErrorRateQuery,
  topToolErrorsQuery,
  topToolExecutionsQuery,
  topToolLatencyQuery,
  totalErrorsQuery,
  totalOpsQuery,
} from '../../dashboard/queries';
import { MetricPanel } from './MetricPanel';

type DashboardToolsGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
  onTimeRangeChange: (timeRange: TimeRange) => void;
};

type ToolSortKey = 'toolName' | 'executions' | 'errors' | 'errorRate' | 'latencyP95';
type ToolSortDirection = 'asc' | 'desc';

const CHART_HEIGHT = 250;
const TABLE_PREVIEW_ROWS = 8;

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardToolsGrid({
  dataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
  onTimeRangeChange,
}: DashboardToolsGridProps) {
  const styles = useStyles2(getStyles);
  const [sortKey, setSortKey] = useState<ToolSortKey>('executions');
  const [sortDirection, setSortDirection] = useState<ToolSortDirection>('desc');
  const sanitizedFilters = useMemo(() => sanitizeToolAnalyticsFilters(filters), [filters]);
  const metricFilters = useMemo(() => buildExecuteToolMetricFilters(sanitizedFilters), [sanitizedFilters]);
  const chartBreakdownBy = useMemo(() => normalizeToolAnalyticsBreakdown(breakdownBy), [breakdownBy]);
  const statsBreakdownBy = useMemo(() => resolveToolAnalyticsStatBreakdown(breakdownBy), [breakdownBy]);
  const windowSize = useMemo(() => Math.max(0, to - from), [from, to]);
  const prevFrom = useMemo(() => Math.max(0, from - windowSize), [from, windowSize]);
  const prevTo = useMemo(() => from, [from]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const prevRangeDuration = useMemo(() => computeRangeDuration(prevFrom, prevTo), [prevFrom, prevTo]);
  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const comparisonLabel = useMemo(() => `previous ${formatWindowLabel(windowSize)}`, [windowSize]);
  const breakdownLabel = useMemo(() => {
    switch (statsBreakdownBy) {
      case 'agent':
        return 'gen_ai_agent_name';
      case 'provider':
        return 'gen_ai_provider_name';
      case 'model':
      case 'tool':
      case 'none':
      default:
        return TOOL_METRIC_LABEL;
    }
  }, [statsBreakdownBy]);
  const breakdownTitle = useMemo(() => {
    switch (statsBreakdownBy) {
      case 'agent':
        return 'Top agents';
      case 'provider':
        return 'Top providers';
      case 'model':
        return 'Top models';
      case 'tool':
      case 'none':
      default:
        return 'Top tools';
    }
  }, [statsBreakdownBy]);
  const errorBreakdownTitle = useMemo(() => {
    switch (statsBreakdownBy) {
      case 'agent':
        return 'Agents with errors';
      case 'provider':
        return 'Providers with errors';
      case 'model':
        return 'Models with errors';
      case 'tool':
      case 'none':
      default:
        return 'Most errors';
    }
  }, [statsBreakdownBy]);
  const latencyBreakdownTitle = useMemo(() => {
    switch (statsBreakdownBy) {
      case 'agent':
        return 'Slowest agents (P95)';
      case 'provider':
        return 'Slowest providers (P95)';
      case 'model':
        return 'Slowest models (P95)';
      case 'tool':
      case 'none':
      default:
        return 'Slowest tools (P95)';
    }
  }, [statsBreakdownBy]);

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
  const usageOverTime = usePrometheusQuery(
    dataSource,
    requestCountOverTimeQuery(metricFilters, `${step}s`, chartBreakdownBy),
    from,
    to,
    'range',
    step
  );
  const errorRateOverTime = usePrometheusQuery(
    dataSource,
    errorRateOverTimeQuery(metricFilters, interval, chartBreakdownBy),
    from,
    to,
    'range',
    step
  );
  const latencyP95OverTime = usePrometheusQuery(
    dataSource,
    latencyOverTimeQuery(metricFilters, interval, chartBreakdownBy, 0.95),
    from,
    to,
    'range',
    step
  );
  const breakdownExecutions = usePrometheusQuery(
    dataSource,
    totalOpsQuery(metricFilters, rangeDuration, statsBreakdownBy),
    from,
    to,
    'instant'
  );
  const breakdownErrors = usePrometheusQuery(
    dataSource,
    totalErrorsQuery(metricFilters, rangeDuration, statsBreakdownBy),
    from,
    to,
    'instant'
  );
  const breakdownLatencyP95 = usePrometheusQuery(
    dataSource,
    latencyStatQuery(metricFilters, rangeDuration, statsBreakdownBy, 0.95),
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

  const sortedRows = useMemo(() => {
    const directionFactor = sortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
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
  }, [rows, sortDirection, sortKey]);
  const previewRows = useMemo(() => sortedRows.slice(0, TABLE_PREVIEW_ROWS), [sortedRows]);

  const pageQueryResponses = [
    totalExecutions,
    totalErrors,
    totalErrorRate,
    toolExecutions,
    toolErrors,
    toolErrorRates,
    toolLatencyP95,
    breakdownExecutions,
    breakdownErrors,
    breakdownLatencyP95,
    usageOverTime,
    errorRateOverTime,
    latencyP95OverTime,
    prevTotalExecutions,
    prevTotalErrors,
    prevTotalErrorRate,
    prevToolExecutions,
  ];
  const pageIsLoading = pageQueryResponses.some((response) => response.loading);
  const pageHasErrors = pageQueryResponses.some((response) => response.error.length > 0);
  const pageHasData = rows.length > 0 || pageQueryResponses.some((response) => hasResponseData(response.data));

  const handleRowClick = useCallback((row: ToolSummaryRow, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      window.open(row.href, '_blank');
      return;
    }
    window.location.href = row.href;
  }, []);

  const handlePanelTimeRangeChange = useCallback(
    (absoluteRange: AbsoluteTimeRange) => {
      const nextFrom = dateTime(absoluteRange.from);
      const nextTo = dateTime(absoluteRange.to);
      onTimeRangeChange({
        from: nextFrom,
        to: nextTo,
        raw: { from: nextFrom.toISOString(), to: nextTo.toISOString() },
      });
    },
    [onTimeRangeChange]
  );

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
        cell: (row) => <span className={styles.monoCell}>{row.toolName}</span>,
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
    [buildSortableHeader, styles.monoCell]
  );

  const totalExecutionsValue = totalExecutions.data ? vectorToStatValue(totalExecutions.data) : 0;
  const totalErrorsValue = totalErrors.data ? vectorToStatValue(totalErrors.data) : 0;
  const totalErrorRateValue = totalErrorRate.data ? vectorToStatValue(totalErrorRate.data) : 0;
  const prevTotalExecutionsValue = prevTotalExecutions.data ? vectorToStatValue(prevTotalExecutions.data) : 0;
  const prevTotalErrorsValue = prevTotalErrors.data ? vectorToStatValue(prevTotalErrors.data) : 0;
  const prevTotalErrorRateValue = prevTotalErrorRate.data ? vectorToStatValue(prevTotalErrorRate.data) : 0;
  const prevToolsMatchedValue = prevToolExecutions.data ? readToolMetricMap(prevToolExecutions.data).size : 0;

  return (
    <div className={styles.grid}>
      <DashboardSummaryBar>
        <TopStat
          label="Tools matched"
          value={rows.length}
          loading={pageIsLoading && rows.length === 0}
          prevValue={prevToolsMatchedValue}
          prevLoading={prevToolExecutions.loading}
          comparisonLabel={comparisonLabel}
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
          Every tool-runtime query failed for this tab. Adjust filters or retry later.
        </Alert>
      )}

      <div className={styles.panelGrid}>
        <div className={styles.panelRow}>
          <MetricPanel
            title="Tool executions over time"
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
            title={breakdownTitle}
            data={breakdownExecutions.data}
            loading={breakdownExecutions.loading}
            error={breakdownExecutions.error}
            breakdownLabel={breakdownLabel}
            height={CHART_HEIGHT}
          />
        </div>

        <div className={styles.panelRow}>
          <MetricPanel
            title="Tool error rate over time"
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
            title={errorBreakdownTitle}
            data={breakdownErrors.data}
            loading={breakdownErrors.loading}
            error={breakdownErrors.error}
            breakdownLabel={breakdownLabel}
            height={CHART_HEIGHT}
          />
        </div>

        <div className={styles.panelRow}>
          <MetricPanel
            title="Tool latency (P95)"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={latencyP95OverTime.loading}
            error={latencyP95OverTime.error}
            data={latencyP95OverTime.data ? matrixToDataFrames(latencyP95OverTime.data) : []}
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
          <BreakdownStatPanel
            title={latencyBreakdownTitle}
            data={breakdownLatencyP95.data}
            loading={breakdownLatencyP95.loading}
            error={breakdownLatencyP95.error}
            breakdownLabel={breakdownLabel}
            height={CHART_HEIGHT}
            unit="s"
            aggregation="avg"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={previewRows}
        keyOf={(row) => row.toolName}
        onRowClick={handleRowClick}
        rowRole="link"
        rowAriaLabel={(row) => `open tool analytics for ${row.toolName}`}
        panelTitle="Tools"
        seeMoreHref={buildToolsUrl(timeRange, sanitizedFilters)}
        seeMoreLabel="Open full tools page"
        loading={pageIsLoading && rows.length === 0}
        loadError={!pageHasData && pageHasErrors ? 'Tool analytics failed to load.' : undefined}
        emptyIcon="wrench"
        emptyMessage="No execute_tool runtime data matched the current filters."
      />
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    ...getCommonCellStyles(theme),
    grid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
    }),
    panelGrid: css({
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
      justifyContent: 'flex-start',
    }),
    sortButtonRight: css({
      justifyContent: 'flex-end',
    }),
  };
}
