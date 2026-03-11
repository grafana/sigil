import type { DashboardFilters } from '../dashboard/types';
import { mapDashboardLabelFiltersToConversation } from './filterKeyMapping';

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

  for (const filter of mapDashboardLabelFiltersToConversation(filters.labelFilters)) {
    parts.push(`${filter.key} ${filter.operator} "${filter.value}"`);
  }
  return parts.join(' ');
}
