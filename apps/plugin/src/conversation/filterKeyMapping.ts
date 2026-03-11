import type { LabelFilter } from '../dashboard/types';

const EXACT_METRIC_LABEL_TO_CONVERSATION_KEY: Record<string, string> = {
  gen_ai_provider_name: 'provider',
  gen_ai_request_model: 'model',
  gen_ai_agent_name: 'agent',
  gen_ai_operation_name: 'operation',
  service_name: 'resource.service.name',
  k8s_namespace_name: 'resource.k8s.namespace.name',
  k8s_cluster_name: 'resource.k8s.cluster.name',
};

const CONVERSATION_KEY_ALIASES: Record<string, string> = {
  service: 'resource.service.name',
  namespace: 'resource.k8s.namespace.name',
  cluster: 'resource.k8s.cluster.name',
  'resource.service': 'resource.service.name',
  'resource.namespace': 'resource.k8s.namespace.name',
  'resource.cluster': 'resource.k8s.cluster.name',
};

const DEFAULT_CONVERSATION_FILTER_KEYS = [
  'provider',
  'model',
  'agent',
  'operation',
  'resource.service.name',
  'resource.k8s.namespace.name',
  'resource.k8s.cluster.name',
  'service',
  'namespace',
  'cluster',
  'agent.version',
  'status',
  'error.type',
  'error.category',
  'tool.name',
  'duration',
  'generation_count',
  'span.gen_ai.provider.name',
  'span.gen_ai.request.model',
  'span.gen_ai.agent.name',
  'span.gen_ai.operation.name',
] as const;

const NON_SIGNAL_TOKENS = new Set(['span', 'resource', 'attribute', 'attributes', 'label', 'labels', 'name']);

type KeyForms = {
  raw: string;
  normalized: string;
  reduced: string;
  tokens: string[];
  reducedTokens: string[];
};

function splitKeyTokens(rawKey: string): string[] {
  return rawKey
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function buildKeyForms(rawKey: string): KeyForms {
  const tokens = splitKeyTokens(rawKey);
  const reducedTokens = tokens.filter((token) => !NON_SIGNAL_TOKENS.has(token));
  return {
    raw: rawKey.trim(),
    normalized: tokens.join(' '),
    reduced: (reducedTokens.length > 0 ? reducedTokens : tokens).join(' '),
    tokens,
    reducedTokens: reducedTokens.length > 0 ? reducedTokens : tokens,
  };
}

function countCommonTokens(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  let common = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      common++;
    }
  }
  return common;
}

function scoreKeyMatch(source: KeyForms, candidate: KeyForms): number {
  if (source.raw === candidate.raw) {
    return 120;
  }
  if (source.normalized.length > 0 && source.normalized === candidate.normalized) {
    return 100;
  }
  if (source.reduced.length > 0 && source.reduced === candidate.reduced) {
    return 90;
  }
  if (
    source.reduced.length > 0 &&
    candidate.reduced.length > 0 &&
    (source.reduced.includes(candidate.reduced) || candidate.reduced.includes(source.reduced))
  ) {
    return 80;
  }

  const common = countCommonTokens(source.reducedTokens, candidate.reducedTokens);
  if (common === 0) {
    return 0;
  }

  const smallerSide = Math.min(source.reducedTokens.length, candidate.reducedTokens.length);
  if (common === smallerSide) {
    return 70 + common;
  }

  return 0;
}

function resolveBestKeyMatch(rawKey: string, candidateKeys: readonly string[]): string | null {
  const source = buildKeyForms(rawKey);
  if (source.raw.length === 0) {
    return null;
  }

  let bestKey: string | null = null;
  let bestScore = 0;

  for (const candidateKey of candidateKeys) {
    const score = scoreKeyMatch(source, buildKeyForms(candidateKey));
    if (score > bestScore) {
      bestKey = candidateKey;
      bestScore = score;
    }
  }

  return bestScore >= 80 ? bestKey : null;
}

export function resolveConversationFilterKey(
  metricLabelKey: string,
  candidateKeys: readonly string[] = DEFAULT_CONVERSATION_FILTER_KEYS
): string | null {
  const trimmedKey = metricLabelKey.trim();
  if (trimmedKey.length === 0) {
    return null;
  }

  const exactMatch = EXACT_METRIC_LABEL_TO_CONVERSATION_KEY[trimmedKey];
  if (exactMatch) {
    return exactMatch;
  }

  if (trimmedKey.startsWith('span.') || trimmedKey.startsWith('resource.')) {
    return canonicalizeConversationFilterKey(trimmedKey);
  }

  const canonicalKey = canonicalizeConversationFilterKey(trimmedKey);
  if (canonicalKey !== trimmedKey) {
    return canonicalKey;
  }

  const bestMatch = resolveBestKeyMatch(trimmedKey, candidateKeys);
  if (!bestMatch) {
    return null;
  }

  return canonicalizeConversationFilterKey(bestMatch);
}

export function canonicalizeConversationFilterKey(key: string): string {
  const trimmedKey = key.trim();
  if (trimmedKey.length === 0) {
    return '';
  }

  return CONVERSATION_KEY_ALIASES[trimmedKey] ?? trimmedKey;
}

export function mapDashboardLabelFiltersToConversation(filters: LabelFilter[]): LabelFilter[] {
  const translated: LabelFilter[] = [];

  for (const filter of filters) {
    if (!filter.key.trim() || !filter.value.trim()) {
      continue;
    }

    const conversationKey = resolveConversationFilterKey(filter.key);
    if (!conversationKey) {
      continue;
    }

    translated.push({ ...filter, key: conversationKey });
  }

  return translated;
}
