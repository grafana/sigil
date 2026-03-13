import type { ModelCardClient } from '../modelcard/api';
import type { ModelCard, ModelCardPricing } from '../modelcard/types';
import type { GenerationCostBreakdown, GenerationCostResult, GenerationDetail, GenerationUsage } from './types';
import { toNum } from '../conversation/aggregates';

export function calculateGenerationCost(usage: GenerationUsage, pricing: ModelCardPricing): GenerationCostBreakdown {
  const inputCost = toNum(usage.input_tokens) * toNum(pricing.prompt_usd_per_token);
  const outputCost = toNum(usage.output_tokens) * toNum(pricing.completion_usd_per_token);
  const cacheReadCost = toNum(usage.cache_read_input_tokens) * toNum(pricing.input_cache_read_usd_per_token);
  const cacheWriteCost = toNum(usage.cache_write_input_tokens) * toNum(pricing.input_cache_write_usd_per_token);
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

type PricingKey = string;

function pricingKey(provider: string, model: string): PricingKey {
  return `${provider.trim().toLowerCase()}::${model.trim()}`;
}

export async function resolveGenerationCost(
  generation: GenerationDetail,
  client: ModelCardClient
): Promise<GenerationCostResult | null> {
  const provider = generation.model?.provider?.trim() ?? '';
  const model = generation.model?.name?.trim() ?? '';
  if (provider.length === 0 || model.length === 0 || !generation.usage) {
    return null;
  }

  const resolveResp = await client.resolve([{ provider, model }]);
  const resolved = resolveResp.resolved[0];
  let pricing: ModelCardPricing | null = null;
  let modelKey = '';

  if (resolved?.status === 'resolved' && resolved.card) {
    pricing = resolved.card.pricing;
    modelKey = resolved.card.model_key;
  }

  const lookupKey = modelKey.length > 0 ? modelKey : `openrouter:${provider}/${model}`;
  try {
    const lookupResp = await client.lookup({ modelKey: lookupKey });
    const effectivePricing = pricing ?? lookupResp.data.pricing;
    const breakdown = calculateGenerationCost(generation.usage, effectivePricing);
    return {
      generationID: generation.generation_id,
      model,
      provider,
      card: lookupResp.data,
      breakdown,
    };
  } catch {
    if (pricing) {
      const breakdown = calculateGenerationCost(generation.usage, pricing);
      return {
        generationID: generation.generation_id,
        model,
        provider,
        card: {
          model_key: modelKey,
          source: 'openrouter',
          source_model_id: resolved!.card!.source_model_id,
          canonical_slug: '',
          name: model,
          provider,
          pricing,
          is_free: false,
          top_provider: {},
          first_seen_at: '',
          last_seen_at: '',
          refreshed_at: '',
        },
        breakdown,
      };
    }
    return null;
  }
}

export async function resolveGenerationCosts(
  generations: GenerationDetail[],
  client: ModelCardClient
): Promise<Map<string, GenerationCostResult>> {
  const results = new Map<string, GenerationCostResult>();

  const pairsByKey = new Map<PricingKey, { provider: string; model: string }>();
  const gensByKey = new Map<PricingKey, GenerationDetail[]>();

  for (const gen of generations) {
    const provider = gen.model?.provider?.trim() ?? '';
    const model = gen.model?.name?.trim() ?? '';
    if (provider.length === 0 || model.length === 0 || !gen.usage) {
      continue;
    }
    const key = pricingKey(provider, model);
    pairsByKey.set(key, { provider, model });
    const list = gensByKey.get(key) ?? [];
    list.push(gen);
    gensByKey.set(key, list);
  }

  if (pairsByKey.size === 0) {
    return results;
  }

  const pairs = Array.from(pairsByKey.values());
  const resolveResp = await client.resolve(pairs);

  const resolvedCards = new Map<PricingKey, { pricing: ModelCardPricing; card: ModelCard }>();
  const keysNeedingLookup: PricingKey[] = [];

  for (const item of resolveResp.resolved) {
    const key = pricingKey(item.provider, item.model);
    if (item.status === 'resolved' && item.card) {
      resolvedCards.set(key, {
        pricing: item.card.pricing,
        card: {
          model_key: item.card.model_key,
          source: 'openrouter',
          source_model_id: item.card.source_model_id,
          canonical_slug: '',
          name: item.model,
          provider: item.provider,
          pricing: item.card.pricing,
          is_free: false,
          top_provider: {},
          first_seen_at: '',
          last_seen_at: '',
          refreshed_at: '',
        },
      });
      keysNeedingLookup.push(key);
    }
  }

  const lookupPromises = keysNeedingLookup.map(async (key) => {
    const existing = resolvedCards.get(key);
    if (!existing) {
      return;
    }
    try {
      const lookupResp = await client.lookup({
        modelKey: existing.card.model_key,
      });
      resolvedCards.set(key, {
        pricing: existing.pricing,
        card: lookupResp.data,
      });
    } catch {
      // Lookup failed; keep the stub card from resolve with pricing intact.
    }
  });

  const unresolvedPairLookups = Array.from(pairsByKey.entries())
    .filter(([key]) => !resolvedCards.has(key))
    .map(async ([key, pair]) => {
      try {
        const lookupResp = await client.lookup({
          modelKey: `openrouter:${pair.provider}/${pair.model}`,
        });
        resolvedCards.set(key, {
          pricing: lookupResp.data.pricing,
          card: lookupResp.data,
        });
      } catch {
        // Model not found in catalog.
      }
    });

  await Promise.all([...lookupPromises, ...unresolvedPairLookups]);

  for (const [key, gens] of gensByKey) {
    const cardInfo = resolvedCards.get(key);
    if (!cardInfo) {
      continue;
    }
    for (const gen of gens) {
      if (!gen.usage) {
        continue;
      }
      const breakdown = calculateGenerationCost(gen.usage, cardInfo.pricing);
      results.set(gen.generation_id, {
        generationID: gen.generation_id,
        model: gen.model?.name?.trim() ?? '',
        provider: gen.model?.provider?.trim() ?? '',
        card: cardInfo.card,
        breakdown,
      });
    }
  }

  return results;
}
