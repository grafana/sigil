import type { Field, RuleGroupType, RuleType } from 'react-querybuilder';
import {
  HEURISTIC_MAX_DEPTH,
  HEURISTIC_MAX_NODES,
  type HeuristicConfig,
  type HeuristicNode,
  type HeuristicOperator,
  type HeuristicRuleType,
} from './types';

export const HEURISTIC_QUERY_FIELD = 'response';

export type HeuristicQueryRule = RuleType<typeof HEURISTIC_QUERY_FIELD, HeuristicRuleType, string | number>;
export type HeuristicQueryGroup = RuleGroupType<HeuristicQueryRule, HeuristicOperator>;

export const HEURISTIC_QUERY_FIELDS: Field[] = [{ name: HEURISTIC_QUERY_FIELD, label: 'Response' }];

export const HEURISTIC_QUERY_OPERATORS = [
  { name: 'not_empty', label: 'is not empty' },
  { name: 'contains', label: 'contains' },
  { name: 'not_contains', label: 'does not contain' },
  { name: 'min_length', label: 'length is at least' },
  { name: 'max_length', label: 'length is at most' },
] as const;

export const HEURISTIC_QUERY_COMBINATORS = [
  { name: 'and', label: 'All of' },
  { name: 'or', label: 'Any of' },
] as const;

export function createDefaultHeuristicConfig(): HeuristicConfig {
  return {
    version: 'v2',
    root: {
      kind: 'group',
      operator: 'and',
      rules: [{ kind: 'rule', type: 'not_empty' }],
    },
  };
}

export function createDefaultHeuristicQuery(config?: unknown): HeuristicQueryGroup {
  return configToQueryGroup(normalizeHeuristicConfig(config) ?? createDefaultHeuristicConfig());
}

export function heuristicQueryToConfig(query: HeuristicQueryGroup): HeuristicConfig {
  return {
    version: 'v2',
    root: queryGroupToConfig(query),
  };
}

export function normalizeHeuristicConfig(config: unknown): HeuristicConfig | undefined {
  if (!isRecord(config) || config.version !== 'v2' || !isRecord(config.root)) {
    return undefined;
  }
  const root = normalizeHeuristicGroup(config.root);
  return root == null ? undefined : { version: 'v2', root };
}

export function validateHeuristicQuery(query: HeuristicQueryGroup): string | undefined {
  const nodeCount = countHeuristicQueryNodes(query);
  if (nodeCount > HEURISTIC_MAX_NODES) {
    return `Use ${HEURISTIC_MAX_NODES} rules or groups or fewer`;
  }
  return validateHeuristicQueryNode(query, 1);
}

export function countHeuristicQueryNodes(group: HeuristicQueryGroup): number {
  return 1 + group.rules.reduce((sum, child) => sum + (isQueryGroup(child) ? countHeuristicQueryNodes(child) : 1), 0);
}

export function formatHeuristicNodeSummary(node: HeuristicNode): string {
  if (node.kind === 'rule') {
    switch (node.type) {
      case 'not_empty':
        return 'response is not empty';
      case 'contains':
        return `contains "${node.value}"`;
      case 'not_contains':
        return `does not contain "${node.value}"`;
      case 'min_length':
        return `length is at least ${node.value}`;
      case 'max_length':
        return `length is at most ${node.value}`;
    }
  }

  const connector = node.operator === 'and' ? 'all of' : 'any of';
  return `${connector}: ${node.rules.map((rule) => formatHeuristicNodeSummary(rule)).join('; ')}`;
}

function validateHeuristicQueryNode(node: HeuristicQueryGroup | HeuristicQueryRule, depth: number): string | undefined {
  if (depth > HEURISTIC_MAX_DEPTH) {
    return `Nest heuristic groups at most ${HEURISTIC_MAX_DEPTH} levels deep`;
  }
  if (isQueryGroup(node)) {
    if (node.rules.length === 0) {
      return 'Each heuristic group needs at least one rule';
    }
    if (node.combinator !== 'and' && node.combinator !== 'or') {
      return 'Each heuristic group needs a valid operator';
    }
    for (const child of node.rules) {
      const error = validateHeuristicQueryNode(child, depth + 1);
      if (error != null) {
        return error;
      }
    }
    return undefined;
  }

  if (node.field !== HEURISTIC_QUERY_FIELD) {
    return 'Heuristic rules must target the response';
  }

  switch (node.operator) {
    case 'not_empty':
      return undefined;
    case 'contains':
    case 'not_contains':
      return String(node.value ?? '').trim() === '' ? 'Text match rules need a value' : undefined;
    case 'min_length':
    case 'max_length': {
      const parsed = parseHeuristicNumber(node.value);
      return parsed == null || parsed < 0 ? 'Length rules need a non-negative value' : undefined;
    }
    default:
      return 'Choose a valid heuristic rule type';
  }
}

function normalizeHeuristicGroup(raw: Record<string, unknown>): HeuristicConfig['root'] | undefined {
  if (raw.kind !== 'group' || (raw.operator !== 'and' && raw.operator !== 'or') || !Array.isArray(raw.rules)) {
    return undefined;
  }
  const rules = raw.rules
    .map((child) => normalizeHeuristicNode(child))
    .filter((child): child is HeuristicNode => child != null);
  if (rules.length === 0) {
    return undefined;
  }
  return {
    kind: 'group',
    operator: raw.operator,
    rules,
  };
}

function normalizeHeuristicNode(raw: unknown): HeuristicNode | undefined {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    return undefined;
  }
  if (raw.kind === 'group') {
    return normalizeHeuristicGroup(raw);
  }
  if (raw.kind !== 'rule' || typeof raw.type !== 'string') {
    return undefined;
  }

  switch (raw.type) {
    case 'not_empty':
      return { kind: 'rule', type: 'not_empty' };
    case 'contains':
    case 'not_contains':
      return typeof raw.value === 'string' && raw.value.trim() !== ''
        ? { kind: 'rule', type: raw.type, value: raw.value.trim() }
        : undefined;
    case 'min_length':
    case 'max_length': {
      const parsed = parseHeuristicNumber(raw.value);
      return parsed != null && parsed >= 0 ? { kind: 'rule', type: raw.type, value: parsed } : undefined;
    }
    default:
      return undefined;
  }
}

function configToQueryGroup(config: HeuristicConfig): HeuristicQueryGroup {
  return {
    combinator: config.root.operator,
    rules: config.root.rules.map((child) => configNodeToQuery(child)),
  };
}

function configNodeToQuery(node: HeuristicNode): HeuristicQueryGroup | HeuristicQueryRule {
  if (node.kind === 'group') {
    return {
      combinator: node.operator,
      rules: node.rules.map((child) => configNodeToQuery(child)),
    };
  }

  switch (node.type) {
    case 'not_empty':
      return { field: HEURISTIC_QUERY_FIELD, operator: 'not_empty', value: '' };
    case 'contains':
    case 'not_contains':
      return { field: HEURISTIC_QUERY_FIELD, operator: node.type, value: node.value };
    case 'min_length':
    case 'max_length':
      return { field: HEURISTIC_QUERY_FIELD, operator: node.type, value: node.value };
  }
}

function queryGroupToConfig(group: HeuristicQueryGroup): HeuristicConfig['root'] {
  return {
    kind: 'group',
    operator: group.combinator,
    rules: group.rules.map((child) => queryNodeToConfig(child)),
  };
}

function queryNodeToConfig(node: HeuristicQueryGroup | HeuristicQueryRule): HeuristicNode {
  if (isQueryGroup(node)) {
    return queryGroupToConfig(node);
  }

  switch (node.operator) {
    case 'not_empty':
      return { kind: 'rule', type: 'not_empty' };
    case 'contains':
    case 'not_contains':
      return { kind: 'rule', type: node.operator, value: String(node.value ?? '').trim() };
    case 'min_length':
    case 'max_length':
      return { kind: 'rule', type: node.operator, value: parseHeuristicNumber(node.value) ?? 0 };
  }
}

function parseHeuristicNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function isQueryGroup(node: HeuristicQueryGroup | HeuristicQueryRule): node is HeuristicQueryGroup {
  return 'rules' in node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
