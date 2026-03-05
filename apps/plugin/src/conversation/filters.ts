import type { DashboardFilters } from '../dashboard/types';

const promLabelToFilterKey: Record<string, string> = {
  gen_ai_provider_name: 'provider',
  gen_ai_request_model: 'model',
  gen_ai_agent_name: 'agent',
};

function buildFilterClause(key: string, values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    return `${key} = "${values[0]}"`;
  }
  return `${key} =~ "${values.join('|')}"`;
}

export function buildConversationSearchFilter(filters: DashboardFilters): string {
  const parts: string[] = [];

  const providerClause = buildFilterClause('provider', filters.providers);
  if (providerClause) {
    parts.push(providerClause);
  }

  const modelClause = buildFilterClause('model', filters.models);
  if (modelClause) {
    parts.push(modelClause);
  }

  const agentClause = buildFilterClause('agent', filters.agentNames);
  if (agentClause) {
    parts.push(agentClause);
  }

  for (const lf of filters.labelFilters) {
    if (lf.key && lf.value) {
      const resolvedKey = promLabelToFilterKey[lf.key] ?? lf.key;
      parts.push(`${resolvedKey} ${lf.operator} "${lf.value}"`);
    }
  }
  return parts.join(' ');
}
