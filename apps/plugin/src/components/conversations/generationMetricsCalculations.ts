import type { GenerationDetail } from '../../conversation/types';
import { lookupPricing, type PricingMap } from '../../dashboard/cost';
import type { ModelCardPricing } from '../../dashboard/types';

function parseNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }
  return undefined;
}

function tokenCost(tokenType: string, count: number, pricing: ModelCardPricing): number {
  switch (tokenType) {
    case 'input':
      return count * (pricing.prompt_usd_per_token ?? 0);
    case 'output':
      return count * (pricing.completion_usd_per_token ?? 0);
    case 'cache_read':
      return count * (pricing.input_cache_read_usd_per_token ?? 0);
    case 'cache_write':
    case 'cache_creation':
      return count * (pricing.input_cache_write_usd_per_token ?? 0);
    default:
      return 0;
  }
}

function readUsageToken(usage: GenerationDetail['usage'], keys: string[]): number {
  if (!usage) {
    return 0;
  }
  for (const key of keys) {
    const count = parseNumericValue(usage[key]);
    if (count != null) {
      return count;
    }
  }
  return 0;
}

export function resolveGenerationTokenCount(generation: GenerationDetail): number | undefined {
  const usage = generation.usage;
  if (!usage) {
    return undefined;
  }
  const total = parseNumericValue(usage.total_tokens);
  if (total != null) {
    return total;
  }
  const input = parseNumericValue(usage.input_tokens);
  const output = parseNumericValue(usage.output_tokens);
  if (input == null && output == null) {
    return undefined;
  }
  return (input ?? 0) + (output ?? 0);
}

export function resolveGenerationLatencyMs(generation: GenerationDetail): number | undefined {
  const start = parseTimestampMs(generation.started_at ?? generation.created_at);
  const end = parseTimestampMs(generation.completed_at);
  if (start == null || end == null) {
    return undefined;
  }
  const latency = end - start;
  if (!Number.isFinite(latency) || latency < 0) {
    return undefined;
  }
  return latency;
}

export function resolveGenerationCostUsd(generation: GenerationDetail, pricingMap: PricingMap): number | undefined {
  const provider = generation.model?.provider;
  const model = generation.model?.name;
  if (!provider || !model) {
    return undefined;
  }
  const pricing = lookupPricing(pricingMap, model, provider);
  if (!pricing) {
    return undefined;
  }

  const usage = generation.usage;
  const inputTokens = readUsageToken(usage, ['input_tokens']);
  const outputTokens = readUsageToken(usage, ['output_tokens']);
  const cacheReadTokens = readUsageToken(usage, ['cache_read_tokens', 'cache_read_input_tokens']);
  const cacheWriteTokens = readUsageToken(usage, [
    'cache_write_tokens',
    'cache_write_input_tokens',
    'cache_creation_tokens',
    'cache_creation_input_tokens',
  ]);

  const hasAnyToken = inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheWriteTokens > 0;
  if (!hasAnyToken) {
    return undefined;
  }

  return (
    tokenCost('input', inputTokens, pricing) +
    tokenCost('output', outputTokens, pricing) +
    tokenCost('cache_read', cacheReadTokens, pricing) +
    tokenCost('cache_write', cacheWriteTokens, pricing)
  );
}
