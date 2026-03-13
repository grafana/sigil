import type { BreakdownDimension, DashboardFilters, LabelFilter } from './types';

export const EXECUTE_TOOL_OPERATION = 'execute_tool';
export const TOOL_METRIC_LABEL = 'gen_ai_request_model';
export const TOOL_CONVERSATION_LABEL = 'tool.name';

function appendLabelFilters(filters: DashboardFilters, extraFilters: LabelFilter[]): DashboardFilters {
  return {
    ...filters,
    labelFilters: [...filters.labelFilters, ...extraFilters],
  };
}

export function sanitizeToolAnalyticsFilters(filters: DashboardFilters): DashboardFilters {
  return {
    ...filters,
    // execute_tool metrics reuse the request-model label to carry the tool name,
    // so model filters cannot produce meaningful results on tool analytics pages.
    models: [],
    labelFilters: filters.labelFilters.filter((filter) => filter.key.trim() !== TOOL_METRIC_LABEL),
  };
}

export function normalizeToolAnalyticsBreakdown(breakdownBy: BreakdownDimension): BreakdownDimension {
  return breakdownBy === 'model' ? 'tool' : breakdownBy;
}

export function resolveToolAnalyticsStatBreakdown(breakdownBy: BreakdownDimension): BreakdownDimension {
  const normalized = normalizeToolAnalyticsBreakdown(breakdownBy);
  return normalized === 'none' ? 'tool' : normalized;
}

export function buildExecuteToolMetricFilters(filters: DashboardFilters): DashboardFilters {
  return appendLabelFilters(sanitizeToolAnalyticsFilters(filters), [
    { key: 'gen_ai_operation_name', operator: '=', value: EXECUTE_TOOL_OPERATION },
  ]);
}

export function buildToolMetricFilters(filters: DashboardFilters, toolName: string): DashboardFilters {
  return appendLabelFilters(buildExecuteToolMetricFilters(filters), [
    { key: TOOL_METRIC_LABEL, operator: '=', value: toolName },
  ]);
}

export function buildToolConversationFilters(filters: DashboardFilters, toolName: string): DashboardFilters {
  return appendLabelFilters(sanitizeToolAnalyticsFilters(filters), [
    { key: TOOL_CONVERSATION_LABEL, operator: '=', value: toolName },
  ]);
}
