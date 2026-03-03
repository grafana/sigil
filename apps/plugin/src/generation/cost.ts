import type { ModelCardClient } from '../modelcard/api';
import type { ModelCard, ModelCardPricing } from '../modelcard/types';
import type { GenerationCostBreakdown, GenerationCostResult, GenerationDetail, GenerationUsage } from './types';

export function calculateGenerationCost(usage: GenerationUsage, pricing: ModelCardPricing): GenerationCostBreakdown {
  const inputCost = (usage.input_tokens ?? 0) * (pricing.prompt_usd_per_token ?? 0);
  const outputCost = (usage.output_tokens ?? 0) * (pricing.completion_usd_per_token ?? 0);
  const cacheReadCost = (usage.cache_read_input_tokens ?? 0) * (pricing.input_cache_read_usd_per_token ?? 0);
  const cacheWriteCost = (usage.cache_write_input_tokens ?? 0) * (pricing.input_cache_write_usd_per_token ?? 0);
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
  if (resolved?.status === 'resolved' && resolved.card) {
    const breakdown = calculateGenerationCost(generation.usage, resolved.card.pricing);
    return {
      generationID: generation.generation_id,
      model,
      provider,
      card: {
        model_key: resolved.card.model_key,
        source: 'openrouter',
        source_model_id: resolved.card.source_model_id,
        canonical_slug: '',
        name: model,
        provider,
        pricing: resolved.card.pricing,
        is_free: false,
        top_provider: {},
        first_seen_at: '',
        last_seen_at: '',
        refreshed_at: '',
      },
      breakdown,
    };
  }

  try {
    const lookupResp = await client.lookup({ modelKey: `openrouter:${provider}/${model}` });
    const breakdown = calculateGenerationCost(generation.usage, lookupResp.data.pricing);
    return {
      generationID: generation.generation_id,
      model,
      provider,
      card: lookupResp.data,
      breakdown,
    };
  } catch {
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
  const unresolvedKeys: PricingKey[] = [];

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
    } else {
      unresolvedKeys.push(key);
    }
  }

  const lookupPromises = unresolvedKeys.map(async (key) => {
    const pair = pairsByKey.get(key);
    if (!pair) {
      return;
    }
    try {
      const lookupResp = await client.lookup({
        modelKey: `openrouter:${pair.provider}/${pair.model}`,
      });
      resolvedCards.set(key, {
        pricing: lookupResp.data.pricing,
        card: lookupResp.data,
      });
    } catch {
      // Model not found in catalog; skip cost calculation for these generations.
    }
  });

  await Promise.all(lookupPromises);

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
