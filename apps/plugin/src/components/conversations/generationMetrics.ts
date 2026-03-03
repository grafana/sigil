import type { GenerationDetail } from '../../conversation/types';
import type { PricingMap } from '../../dashboard/cost';
import type { ModelResolvePair } from '../../dashboard/types';
import {
  resolveGenerationCostUsd,
  resolveGenerationLatencyMs,
  resolveGenerationTokenCount,
} from './generationMetricsCalculations';
import { formatCostUsd, formatLatency, formatTokens } from './generationMetricsFormatting';

export type GenerationMetrics = {
  tokenValue?: number;
  costValueUsd?: number;
  latencyValueMs?: number;
  tokenDisplay: string;
  costDisplay: string;
  latencyDisplay: string;
};

export { formatCostUsd, formatLatency, formatTokens };
export { resolveGenerationCostUsd, resolveGenerationLatencyMs, resolveGenerationTokenCount };

export function buildGenerationMetrics(generation: GenerationDetail, pricingMap: PricingMap): GenerationMetrics {
  const tokenValue = resolveGenerationTokenCount(generation);
  const latencyValueMs = resolveGenerationLatencyMs(generation);
  const costValueUsd = resolveGenerationCostUsd(generation, pricingMap);
  return {
    tokenValue,
    latencyValueMs,
    costValueUsd,
    tokenDisplay: formatTokens(tokenValue),
    latencyDisplay: formatLatency(latencyValueMs),
    costDisplay: formatCostUsd(costValueUsd),
  };
}

export function buildGenerationModelResolvePairs(generations: GenerationDetail[]): ModelResolvePair[] {
  const seen = new Set<string>();
  const pairs: ModelResolvePair[] = [];
  for (const generation of generations) {
    const provider = generation.model?.provider?.trim().toLowerCase();
    const model = generation.model?.name?.trim();
    if (!provider || !model) {
      continue;
    }
    const key = `${provider}::${model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pairs.push({ provider, model });
  }
  return pairs;
}
