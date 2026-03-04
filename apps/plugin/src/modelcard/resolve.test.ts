import type { ModelCardClient } from './api';
import type { ModelCard, ModelCardPricing, ModelCardResolveResponse, ModelCardLookupResponse } from './types';
import { inferProviderFromModelName, resolveModelCardsFromNames } from './resolve';

describe('inferProviderFromModelName', () => {
  const cases: Array<[string, string]> = [
    ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'bedrock'],
    ['us.anthropic.claude-sonnet-4-6', 'bedrock'],
    ['eu.anthropic.claude-opus-4', 'bedrock'],
    ['amazon.nova-pro-v1:0', 'bedrock'],
    ['cohere.command-r-v1:0', 'bedrock'],
    ['meta.llama3-70b-instruct-v1:0', 'bedrock'],
    ['mistral.mistral-large-2407-v1:0', 'bedrock'],
    ['claude-sonnet-4-5', 'anthropic'],
    ['claude-haiku-4.5', 'anthropic'],
    ['gpt-4o', 'openai'],
    ['gpt-4-turbo', 'openai'],
    ['o1-pro', 'openai'],
    ['o3-mini', 'openai'],
    ['gemini-2.5-pro', 'google'],
    ['gemma-2-9b', 'google'],
    ['grok-4', 'x-ai'],
    ['llama-4-maverick', 'meta-llama'],
    ['mistral-large-latest', 'mistralai'],
    ['mixtral-8x7b', 'mistralai'],
    ['ministral-8b', 'mistralai'],
    ['command-r-plus', 'cohere'],
    ['nova-pro-v1', 'amazon'],
    ['anthropic/claude-sonnet-4.5', 'anthropic'],
    ['openai/gpt-4o', 'openai'],
    ['', ''],
    ['  ', ''],
    ['unknown-model-xyz', ''],
  ];

  it.each(cases)('inferProviderFromModelName(%j) → %j', (input, expected) => {
    expect(inferProviderFromModelName(input)).toBe(expected);
  });
});

describe('resolveModelCardsFromNames', () => {
  const basePricing: ModelCardPricing = {
    prompt_usd_per_token: 0.001,
    completion_usd_per_token: 0.005,
    request_usd: null,
    image_usd: null,
    web_search_usd: null,
    input_cache_read_usd_per_token: null,
    input_cache_write_usd_per_token: null,
  };

  const fullCard: ModelCard = {
    model_key: 'openrouter:anthropic/claude-haiku-4.5',
    source: 'openrouter',
    source_model_id: 'anthropic/claude-haiku-4.5',
    canonical_slug: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    pricing: basePricing,
    is_free: false,
    top_provider: { context_length: 200000 },
    first_seen_at: '2025-01-01T00:00:00Z',
    last_seen_at: '2026-03-03T00:00:00Z',
    refreshed_at: '2026-03-03T00:00:00Z',
  };

  function mockClient(overrides?: Partial<ModelCardClient>): ModelCardClient {
    return {
      resolve: overrides?.resolve ?? jest.fn(),
      lookup: overrides?.lookup ?? jest.fn(),
    };
  }

  it('resolves bedrock model names to model cards', async () => {
    const resolveResponse: ModelCardResolveResponse = {
      resolved: [
        {
          provider: 'bedrock',
          model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
          status: 'resolved',
          match_strategy: 'exact',
          card: {
            model_key: 'openrouter:anthropic/claude-haiku-4.5',
            source_model_id: 'anthropic/claude-haiku-4.5',
            pricing: basePricing,
          },
        },
      ],
      freshness: {
        catalog_last_refreshed_at: '2026-03-03T00:00:00Z',
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };

    const lookupResponse: ModelCardLookupResponse = {
      data: fullCard,
      freshness: {
        catalog_last_refreshed_at: '2026-03-03T00:00:00Z',
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };

    const client = mockClient({
      resolve: jest.fn().mockResolvedValue(resolveResponse),
      lookup: jest.fn().mockResolvedValue(lookupResponse),
    });

    const cards = await resolveModelCardsFromNames(['us.anthropic.claude-haiku-4-5-20251001-v1:0'], client);

    expect(cards.size).toBe(1);
    const card = cards.values().next().value;
    expect(card?.name).toBe('Claude Haiku 4.5');
    expect(card?.model_key).toBe('openrouter:anthropic/claude-haiku-4.5');

    expect(client.resolve).toHaveBeenCalledWith([
      { provider: 'bedrock', model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
    ]);
  });

  it('keeps stub card when lookup fails', async () => {
    const resolveResponse: ModelCardResolveResponse = {
      resolved: [
        {
          provider: 'bedrock',
          model: 'us.anthropic.claude-sonnet-4-6',
          status: 'resolved',
          match_strategy: 'exact',
          card: {
            model_key: 'openrouter:anthropic/claude-sonnet-4.6',
            source_model_id: 'anthropic/claude-sonnet-4.6',
            pricing: basePricing,
          },
        },
      ],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };

    const client = mockClient({
      resolve: jest.fn().mockResolvedValue(resolveResponse),
      lookup: jest.fn().mockRejectedValue(new Error('not found')),
    });

    const cards = await resolveModelCardsFromNames(['us.anthropic.claude-sonnet-4-6'], client);

    expect(cards.size).toBe(1);
    const card = cards.values().next().value;
    expect(card?.model_key).toBe('openrouter:anthropic/claude-sonnet-4.6');
    expect(card?.provider).toBe('bedrock');
  });

  it('returns empty map for unresolved models', async () => {
    const resolveResponse: ModelCardResolveResponse = {
      resolved: [
        {
          provider: 'bedrock',
          model: 'us.anthropic.claude-sonnet-4-6',
          status: 'unresolved',
          reason: 'not_found',
        },
      ],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };

    const client = mockClient({
      resolve: jest.fn().mockResolvedValue(resolveResponse),
      lookup: jest.fn(),
    });

    const cards = await resolveModelCardsFromNames(['us.anthropic.claude-sonnet-4-6'], client);

    expect(cards.size).toBe(0);
    expect(client.lookup).not.toHaveBeenCalled();
  });

  it('returns empty map for empty model names', async () => {
    const client = mockClient();
    const cards = await resolveModelCardsFromNames([], client);
    expect(cards.size).toBe(0);
    expect(client.resolve).not.toHaveBeenCalled();
  });

  it('uses providerMap over inference when available', async () => {
    const resolveResponse: ModelCardResolveResponse = {
      resolved: [
        {
          provider: 'bedrock',
          model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
          status: 'resolved',
          match_strategy: 'exact',
          card: {
            model_key: 'openrouter:anthropic/claude-haiku-4.5',
            source_model_id: 'anthropic/claude-haiku-4.5',
            pricing: basePricing,
          },
        },
      ],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };

    const client = mockClient({
      resolve: jest.fn().mockResolvedValue(resolveResponse),
      lookup: jest.fn().mockRejectedValue(new Error('not found')),
    });

    const providerMap = {
      'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'bedrock',
    };

    const cards = await resolveModelCardsFromNames(
      ['us.anthropic.claude-haiku-4-5-20251001-v1:0'],
      client,
      providerMap
    );

    expect(client.resolve).toHaveBeenCalledWith([
      { provider: 'bedrock', model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
    ]);
    expect(cards.size).toBe(1);
  });

  it('skips model names where provider cannot be inferred', async () => {
    const resolveResponse: ModelCardResolveResponse = {
      resolved: [
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          status: 'resolved',
          match_strategy: 'exact',
          card: {
            model_key: 'openrouter:anthropic/claude-sonnet-4.5',
            source_model_id: 'anthropic/claude-sonnet-4.5',
            pricing: basePricing,
          },
        },
      ],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };

    const client = mockClient({
      resolve: jest.fn().mockResolvedValue(resolveResponse),
      lookup: jest.fn().mockRejectedValue(new Error('not found')),
    });

    const cards = await resolveModelCardsFromNames(['unknown-xyz-model', 'claude-sonnet-4-5'], client);

    expect(client.resolve).toHaveBeenCalledWith([{ provider: 'anthropic', model: 'claude-sonnet-4-5' }]);
    expect(cards.size).toBe(1);
  });
});
