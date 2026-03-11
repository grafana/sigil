import { ATTR_OPERATION_NAME, OperationName } from './attributes';
import type { DashboardFilters, LabelFilter } from '../dashboard/types';
import { canonicalizeConversationFilterKey } from './filterKeyMapping';

const DISCOVERY_OPERATION_NAMES = [OperationName.GenerateText, OperationName.StreamText, OperationName.ExecuteTool];
const CONVERSATION_SEARCH_KEY_TO_TRACEQL_KEY: Record<string, string> = {
  provider: 'span.gen_ai.provider.name',
  model: 'span.gen_ai.request.model',
  agent: 'span.gen_ai.agent.name',
  operation: 'span.gen_ai.operation.name',
};

function toSpanAttribute(key: string): string {
  return `span.${key}`;
}

function traceQLLiteral(value: string): string {
  return JSON.stringify(value);
}

function resolveTraceQLKey(rawKey: string): string {
  const trimmedKey = rawKey.trim();
  if (trimmedKey.length === 0) {
    return '';
  }

  const exactKey = CONVERSATION_SEARCH_KEY_TO_TRACEQL_KEY[trimmedKey];
  if (exactKey) {
    return exactKey;
  }

  const canonicalKey = canonicalizeConversationFilterKey(trimmedKey);
  const canonicalExactKey = CONVERSATION_SEARCH_KEY_TO_TRACEQL_KEY[canonicalKey];
  if (canonicalExactKey) {
    return canonicalExactKey;
  }

  return canonicalKey;
}

function buildLabelFilterPredicates(filters: LabelFilter[]): string[] {
  return filters.flatMap((filter) => {
    if (!filter.key.trim() || !filter.value.trim()) {
      return [];
    }

    const traceQLKey = resolveTraceQLKey(filter.key);
    if (traceQLKey.length === 0) {
      return [];
    }

    return [`${traceQLKey} ${filter.operator} ${traceQLLiteral(filter.value)}`];
  });
}

export function buildConversationTagDiscoveryQuery(filters?: DashboardFilters): string {
  const operationKey = toSpanAttribute(ATTR_OPERATION_NAME);
  const operations = DISCOVERY_OPERATION_NAMES.join('|');
  const predicates = [`${operationKey} =~ "${operations}"`];

  if (filters) {
    predicates.push(
      ...filters.providers.map((provider) => `span.gen_ai.provider.name = ${JSON.stringify(provider)}`),
      ...filters.models.map((model) => `span.gen_ai.request.model = ${JSON.stringify(model)}`),
      ...filters.agentNames.map((agent) => `span.gen_ai.agent.name = ${JSON.stringify(agent)}`),
      ...buildLabelFilterPredicates(filters.labelFilters)
    );
  }

  return `{ ${predicates.join(' && ')} }`;
}
