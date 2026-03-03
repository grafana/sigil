import type { ModelCardClient } from '../modelcard/api';
import type {
  ModelCard,
  ModelCardPricing,
  ModelCardResolveResponse,
  ModelCardLookupResponse,
} from '../modelcard/types';
import { calculateGenerationCost, resolveGenerationCost, resolveGenerationCosts } from './cost';
import type { GenerationDetail, GenerationUsage } from './types';

const basePricing: ModelCardPricing = {
  prompt_usd_per_token: 0.002,
  completion_usd_per_token: 0.008,
  request_usd: null,
  image_usd: null,
  web_search_usd: null,
  input_cache_read_usd_per_token: 0.001,
  input_cache_write_usd_per_token: 0.003,
};

const testCard: ModelCard = {
  model_key: 'openrouter:openai/gpt-4o',
  source: 'openrouter',
  source_model_id: 'openai/gpt-4o',
  canonical_slug: 'openai/gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  context_length: 128000,
  modality: 'text+image->text',
  tokenizer: 'o200k_base',
  pricing: basePricing,
  is_free: false,
  top_provider: { context_length: 128000, max_completion_tokens: 16384 },
  first_seen_at: '2025-01-01T00:00:00Z',
  last_seen_at: '2026-03-03T00:00:00Z',
  refreshed_at: '2026-03-03T00:00:00Z',
};

function makeGen(overrides: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    generation_id: 'gen-1',
    conversation_id: 'conv-1',
    model: { provider: 'openai', name: 'gpt-4o' },
    usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
    ...overrides,
  };
}

function makeResolvedResponse(items: ModelCardResolveResponse['resolved']): ModelCardResolveResponse {
  return {
    resolved: items,
    freshness: {
      catalog_last_refreshed_at: null,
      stale: false,
      soft_stale: false,
      hard_stale: false,
      source_path: 'memory_live',
    },
  };
}

describe('calculateGenerationCost', () => {
  it('calculates cost for input and output tokens only', () => {
    const usage: GenerationUsage = { input_tokens: 1000, output_tokens: 500 };
    const result = calculateGenerationCost(usage, basePricing);
    expect(result.inputCost).toBeCloseTo(2.0);
    expect(result.outputCost).toBeCloseTo(4.0);
    expect(result.cacheReadCost).toBe(0);
    expect(result.cacheWriteCost).toBe(0);
    expect(result.totalCost).toBeCloseTo(6.0);
  });

  it('includes cache token costs', () => {
    const usage: GenerationUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 200,
      cache_write_input_tokens: 80,
    };
    const result = calculateGenerationCost(usage, basePricing);
    expect(result.inputCost).toBeCloseTo(0.2);
    expect(result.outputCost).toBeCloseTo(0.4);
    expect(result.cacheReadCost).toBeCloseTo(0.2);
    expect(result.cacheWriteCost).toBeCloseTo(0.24);
    expect(result.totalCost).toBeCloseTo(1.04);
  });

  it('handles zero tokens', () => {
    const usage: GenerationUsage = {};
    const result = calculateGenerationCost(usage, basePricing);
    expect(result.totalCost).toBe(0);
  });

  it('handles null pricing rates', () => {
    const nullPricing: ModelCardPricing = {
      prompt_usd_per_token: null,
      completion_usd_per_token: null,
      request_usd: null,
      image_usd: null,
      web_search_usd: null,
      input_cache_read_usd_per_token: null,
      input_cache_write_usd_per_token: null,
    };
    const usage: GenerationUsage = { input_tokens: 1000, output_tokens: 500 };
    const result = calculateGenerationCost(usage, nullPricing);
    expect(result.totalCost).toBe(0);
  });
});

describe('resolveGenerationCost', () => {
  it('uses resolve API for pricing and lookup for full card', async () => {
    const lookupResp: ModelCardLookupResponse = {
      data: testCard,
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
    const client: ModelCardClient = {
      resolve: jest.fn().mockResolvedValue(
        makeResolvedResponse([
          {
            provider: 'openai',
            model: 'gpt-4o',
            status: 'resolved',
            match_strategy: 'exact',
            card: { model_key: testCard.model_key, source_model_id: testCard.source_model_id, pricing: basePricing },
          },
        ])
      ),
      lookup: jest.fn().mockResolvedValue(lookupResp),
    };

    const gen = makeGen();
    const result = await resolveGenerationCost(gen, client);

    expect(result).not.toBeNull();
    expect(result!.generationID).toBe('gen-1');
    expect(result!.breakdown.totalCost).toBeCloseTo(6.0);
    expect(client.lookup).toHaveBeenCalledTimes(1);
    expect(client.lookup).toHaveBeenCalledWith({ modelKey: testCard.model_key });
    expect(result!.card.context_length).toBe(128000);
    expect(result!.card.name).toBe('GPT-4o');
  });

  it('falls back to lookup when resolve fails', async () => {
    const lookupResp: ModelCardLookupResponse = {
      data: testCard,
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
    const client: ModelCardClient = {
      resolve: jest
        .fn()
        .mockResolvedValue(
          makeResolvedResponse([{ provider: 'openai', model: 'gpt-4o', status: 'unresolved', reason: 'not_found' }])
        ),
      lookup: jest.fn().mockResolvedValue(lookupResp),
    };

    const result = await resolveGenerationCost(makeGen(), client);

    expect(result).not.toBeNull();
    expect(result!.card.name).toBe('GPT-4o');
    expect(client.lookup).toHaveBeenCalledWith({ modelKey: 'openrouter:openai/gpt-4o' });
  });

  it('returns null when generation has no model', async () => {
    const client: ModelCardClient = { resolve: jest.fn(), lookup: jest.fn() };
    const result = await resolveGenerationCost(makeGen({ model: undefined }), client);
    expect(result).toBeNull();
    expect(client.resolve).not.toHaveBeenCalled();
  });

  it('returns null when generation has no usage', async () => {
    const client: ModelCardClient = { resolve: jest.fn(), lookup: jest.fn() };
    const result = await resolveGenerationCost(makeGen({ usage: undefined }), client);
    expect(result).toBeNull();
  });
});

describe('resolveGenerationCosts', () => {
  it('deduplicates model pairs and enriches with full card via lookup', async () => {
    const lookupResp: ModelCardLookupResponse = {
      data: testCard,
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
    const resolveFn = jest.fn().mockResolvedValue(
      makeResolvedResponse([
        {
          provider: 'openai',
          model: 'gpt-4o',
          status: 'resolved',
          card: { model_key: testCard.model_key, source_model_id: testCard.source_model_id, pricing: basePricing },
        },
      ])
    );
    const lookupFn = jest.fn().mockResolvedValue(lookupResp);
    const client: ModelCardClient = { resolve: resolveFn, lookup: lookupFn };

    const gens = [
      makeGen({ generation_id: 'gen-1' }),
      makeGen({ generation_id: 'gen-2', usage: { input_tokens: 200, output_tokens: 100 } }),
    ];
    const results = await resolveGenerationCosts(gens, client);

    expect(resolveFn).toHaveBeenCalledTimes(1);
    expect(resolveFn).toHaveBeenCalledWith([{ provider: 'openai', model: 'gpt-4o' }]);
    expect(lookupFn).toHaveBeenCalledWith({ modelKey: testCard.model_key });
    expect(results.size).toBe(2);
    expect(results.get('gen-1')!.breakdown.totalCost).toBeCloseTo(6.0);
    expect(results.get('gen-1')!.card.context_length).toBe(128000);
    expect(results.get('gen-2')!.breakdown.totalCost).toBeCloseTo(1.2);
  });

  it('uses lookup fallback for unresolved pairs', async () => {
    const lookupResp: ModelCardLookupResponse = {
      data: testCard,
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
    const client: ModelCardClient = {
      resolve: jest
        .fn()
        .mockResolvedValue(
          makeResolvedResponse([{ provider: 'openai', model: 'gpt-4o', status: 'unresolved', reason: 'not_found' }])
        ),
      lookup: jest.fn().mockResolvedValue(lookupResp),
    };

    const results = await resolveGenerationCosts([makeGen()], client);
    expect(results.size).toBe(1);
    expect(client.lookup).toHaveBeenCalled();
  });

  it('skips generations without model or usage', async () => {
    const client: ModelCardClient = {
      resolve: jest.fn().mockResolvedValue(makeResolvedResponse([])),
      lookup: jest.fn(),
    };

    const gens = [
      makeGen({ model: undefined }),
      makeGen({ usage: undefined }),
      makeGen({ model: { provider: '', name: '' } }),
    ];
    const results = await resolveGenerationCosts(gens, client);
    expect(results.size).toBe(0);
  });
});
