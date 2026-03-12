import type { DashboardFilters, LabelFilter } from './types';

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
    // Tool runtime metrics currently reuse the request-model metric label as the
    // tool dimension for execute_tool queries, so model filters cannot coexist
    // with tool selection on the same label.
    models: [],
    labelFilters: filters.labelFilters.filter((filter) => filter.key.trim() !== TOOL_METRIC_LABEL),
  };
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
