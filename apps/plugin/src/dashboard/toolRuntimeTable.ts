import type { TimeRange } from '@grafana/data';
import type { DashboardFilters, PrometheusQueryResponse } from './types';
import { buildToolAnalyticsUrl } from './url';
import { TOOL_METRIC_LABEL } from './toolRuntime';

export type ToolSummaryRow = {
  toolName: string;
  href: string;
  executions: number;
  errors: number;
  errorRate: number;
  latencyP95: number;
};

export function readToolMetricMap(response: PrometheusQueryResponse | null | undefined): Map<string, number> {
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

export function buildToolRows(
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

export function formatToolCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatToolDurationSeconds(value: number): string {
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
