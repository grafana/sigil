import React, { useMemo } from 'react';
import type { TimeRange } from '@grafana/data';
import type { DashboardDataSource } from '../../dashboard/api';
import { computeRangeDuration, topToolExecutionsQuery } from '../../dashboard/queries';
import { TOOL_METRIC_LABEL } from '../../dashboard/toolRuntime';
import { buildToolAnalyticsUrl } from '../../dashboard/url';
import { usePrometheusQuery } from './usePrometheusQuery';
import { BreakdownStatPanel } from './dashboardShared';
import type { DashboardFilters } from '../../dashboard/types';

const PANEL_HEIGHT = 250;

export type TopToolsPanelProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  from: number;
  to: number;
  timeRange: TimeRange;
};

export function TopToolsPanel({ dataSource, filters, from, to, timeRange }: TopToolsPanelProps) {
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const topTools = usePrometheusQuery(dataSource, topToolExecutionsQuery(filters, rangeDuration), from, to, 'instant');

  const getToolHref = useMemo(
    () => (toolName: string) => buildToolAnalyticsUrl(timeRange, filters, toolName),
    [filters, timeRange]
  );

  return (
    <BreakdownStatPanel
      title="Top tools"
      data={topTools.data}
      loading={topTools.loading}
      error={topTools.error}
      breakdownLabel={TOOL_METRIC_LABEL}
      height={PANEL_HEIGHT}
      getItemHref={getToolHref}
    />
  );
}
