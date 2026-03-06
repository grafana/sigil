import type { GenerationCostResult, GenerationDetail } from '../generation/types';
import type { ConversationData, ConversationSpan } from './types';
import { getSpanType, type SpanType } from './spans';

export type TokenSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

function emptyTokenSummary(): TokenSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function toFiniteTokenNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function addUsageToSummary(summary: TokenSummary, gen: GenerationDetail): void {
  const u = gen.usage;
  if (!u) {
    return;
  }
  const inputTokens = toFiniteTokenNumber(u.input_tokens);
  const outputTokens = toFiniteTokenNumber(u.output_tokens);
  const cacheReadTokens = toFiniteTokenNumber(u.cache_read_input_tokens);
  const cacheWriteTokens = toFiniteTokenNumber(u.cache_write_input_tokens);
  summary.inputTokens += inputTokens;
  summary.outputTokens += outputTokens;
  summary.cacheReadTokens += cacheReadTokens;
  summary.cacheWriteTokens += cacheWriteTokens;
  summary.reasoningTokens += toFiniteTokenNumber(u.reasoning_tokens);
  summary.totalTokens += inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
}

export function getAllGenerations(data: ConversationData): GenerationDetail[] {
  const result: GenerationDetail[] = [];
  function walkSpans(spans: ConversationSpan[]): void {
    for (const span of spans) {
      if (span.generation) {
        result.push(span.generation);
      }
      walkSpans(span.children);
    }
  }
  walkSpans(data.spans);
  result.push(...data.orphanGenerations);
  return result;
}

export function getAllSpans(data: ConversationData): ConversationSpan[] {
  const result: ConversationSpan[] = [];
  function walk(spans: ConversationSpan[]): void {
    for (const span of spans) {
      result.push(span);
      walk(span.children);
    }
  }
  walk(data.spans);
  return result;
}

export function getTokenSummary(data: ConversationData): TokenSummary {
  const summary = emptyTokenSummary();
  for (const gen of getAllGenerations(data)) {
    addUsageToSummary(summary, gen);
  }
  return summary;
}

export type CostSummary = {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
};

export function getCostSummary(costs: Map<string, GenerationCostResult>): CostSummary {
  const summary: CostSummary = {
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
  };
  for (const [, cost] of costs) {
    summary.totalCost += cost.breakdown.totalCost;
    summary.inputCost += cost.breakdown.inputCost;
    summary.outputCost += cost.breakdown.outputCost;
    summary.cacheReadCost += cost.breakdown.cacheReadCost;
    summary.cacheWriteCost += cost.breakdown.cacheWriteCost;
  }
  return summary;
}

export type ModelUsageEntry = {
  provider: string;
  model: string;
  generationCount: number;
  tokens: TokenSummary;
};

export function getModelUsageBreakdown(data: ConversationData): ModelUsageEntry[] {
  const byKey = new Map<string, ModelUsageEntry>();

  for (const gen of getAllGenerations(data)) {
    const provider = gen.model?.provider ?? 'unknown';
    const model = gen.model?.name ?? 'unknown';
    const key = `${provider}::${model}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { provider, model, generationCount: 0, tokens: emptyTokenSummary() };
      byKey.set(key, entry);
    }
    entry.generationCount += 1;
    addUsageToSummary(entry.tokens, gen);
  }

  return Array.from(byKey.values());
}

export type ErrorSummary = {
  totalErrors: number;
  errorsByType: Map<string, number>;
};

export function getErrorSummary(data: ConversationData): ErrorSummary {
  const errorsByType = new Map<string, number>();
  let totalErrors = 0;

  for (const gen of getAllGenerations(data)) {
    if (gen.error?.message) {
      totalErrors += 1;
      const errorType = 'generation_error';
      errorsByType.set(errorType, (errorsByType.get(errorType) ?? 0) + 1);
    }
  }

  return { totalErrors, errorsByType };
}

export type SpanSummary = {
  totalSpans: number;
  generationSpans: number;
  toolExecutionSpans: number;
  embeddingSpans: number;
  frameworkSpans: number;
  otherSpans: number;
};

export function getSpanSummary(data: ConversationData): SpanSummary {
  const counts: Record<SpanType, number> = {
    generation: 0,
    tool_execution: 0,
    embedding: 0,
    framework: 0,
    unknown: 0,
  };

  for (const span of getAllSpans(data)) {
    counts[getSpanType(span)] += 1;
  }

  return {
    totalSpans: counts.generation + counts.tool_execution + counts.embedding + counts.framework + counts.unknown,
    generationSpans: counts.generation,
    toolExecutionSpans: counts.tool_execution,
    embeddingSpans: counts.embedding,
    frameworkSpans: counts.framework,
    otherSpans: counts.unknown,
  };
}

export function getConversationDuration(data: ConversationData): bigint {
  let minStart: bigint | null = null;
  let maxEnd: bigint | null = null;

  for (const span of getAllSpans(data)) {
    if (minStart === null || span.startTimeUnixNano < minStart) {
      minStart = span.startTimeUnixNano;
    }
    if (maxEnd === null || span.endTimeUnixNano > maxEnd) {
      maxEnd = span.endTimeUnixNano;
    }
  }

  if (minStart === null || maxEnd === null) {
    return BigInt(0);
  }

  return maxEnd - minStart;
}
