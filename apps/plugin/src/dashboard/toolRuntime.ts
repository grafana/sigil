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

function dropMetricLabelConflicts(filters: DashboardFilters): DashboardFilters {
  return {
    ...filters,
    // Current MVP tool metrics reuse the request-model metric label as the
    // tool dimension for execute_tool queries, so model filters would conflict
    // with the selected tool name on the same Prometheus label.
    models: [],
    labelFilters: filters.labelFilters.filter((filter) => filter.key.trim() !== TOOL_METRIC_LABEL),
  };
}

export function buildToolMetricFilters(filters: DashboardFilters, toolName: string): DashboardFilters {
  return appendLabelFilters(dropMetricLabelConflicts(filters), [
    { key: 'gen_ai_operation_name', operator: '=', value: EXECUTE_TOOL_OPERATION },
    { key: TOOL_METRIC_LABEL, operator: '=', value: toolName },
  ]);
}

export function buildToolConversationFilters(filters: DashboardFilters, toolName: string): DashboardFilters {
  return appendLabelFilters(filters, [{ key: TOOL_CONVERSATION_LABEL, operator: '=', value: toolName }]);
}
