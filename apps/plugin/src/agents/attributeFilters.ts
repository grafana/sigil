import type { SelectableValue } from '@grafana/data';
import type { SearchTag } from '../conversation/types';
import type { AgentAttributeFilter } from './types';

const PINNED_KEYS = [
  'resource.k8s.namespace.name',
  'resource.k8s.cluster.name',
  'resource.service.name',
] as const;

export function parseAgentAttributeFilters(params: URLSearchParams): AgentAttributeFilter[] {
  const raw = params.getAll('attr');
  const filters: AgentAttributeFilter[] = [];
  for (const entry of raw) {
    const first = entry.indexOf('|');
    if (first <= 0) {
      continue;
    }
    const key = entry.slice(0, first);
    const rest = entry.slice(first + 1);
    const second = rest.indexOf('|');
    if (second <= 0) {
      continue;
    }
    const operator = rest.slice(0, second);
    const value = rest.slice(second + 1);
    if (operator === '=' || operator === '!=' || operator === '=~') {
      filters.push({ key, operator, value });
    }
  }
  return filters;
}

export function writeAgentAttributeFilters(params: URLSearchParams, filters: AgentAttributeFilter[]): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('attr');
  for (const filter of filters) {
    if (filter.key && filter.value) {
      next.append('attr', `${filter.key}|${filter.operator}|${filter.value}`);
    }
  }
  return next;
}

export function buildAgentAttributeFilterExpression(filters: AgentAttributeFilter[]): string {
  return filters
    .filter((filter) => filter.key && filter.value)
    .map((filter) => `${filter.key} ${filter.operator} ${JSON.stringify(filter.value)}`)
    .join(' ');
}

export function rankAgentSearchTags(tags: SearchTag[]): Array<SelectableValue<string>> {
  return [...tags]
    .filter((tag) => tag.scope === 'resource' || tag.scope === 'span')
    .sort((left, right) => compareTagKeys(left.key, right.key))
    .map((tag) => ({
      label: tag.key,
      value: tag.key,
      description: tag.description,
    }));
}

function compareTagKeys(left: string, right: string): number {
  return keyRank(left) - keyRank(right) || left.localeCompare(right);
}

function keyRank(key: string): number {
  const pinnedIndex = PINNED_KEYS.indexOf(key as (typeof PINNED_KEYS)[number]);
  if (pinnedIndex >= 0) {
    return pinnedIndex;
  }
  if (key.startsWith('span.sigil.')) {
    return 10;
  }
  if (key.startsWith('span.gen_ai.')) {
    return 20;
  }
  if (key.startsWith('resource.')) {
    return 30;
  }
  if (key.startsWith('span.')) {
    return 40;
  }
  return 50;
}
