import { of } from 'rxjs';
import { defaultModelCardClient, resetModelCardClientCacheForTests, type ModelCardClient } from './api';
import type { ModelCard, ModelCardLookupResponse, ModelCardPricing, ModelCardResolveResponse } from './types';

const backendFetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({
    fetch: backendFetchMock,
  }),
}));

const basePricing: ModelCardPricing = {
  prompt_usd_per_token: 0.0025,
  completion_usd_per_token: 0.01,
  request_usd: null,
  image_usd: null,
  web_search_usd: null,
  input_cache_read_usd_per_token: 0.00125,
  input_cache_write_usd_per_token: 0.00315,
};

const testCard: ModelCard = {
  model_key: 'openrouter:openai/gpt-4o',
  source: 'openrouter',
  source_model_id: 'openai/gpt-4o',
  canonical_slug: 'openai/gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  description: 'OpenAI GPT-4o',
  context_length: 128000,
  modality: 'text',
  pricing: basePricing,
  is_free: false,
  top_provider: { context_length: 128000, max_completion_tokens: 16384 },
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

describe('ModelCardClient', () => {
  beforeEach(() => {
    backendFetchMock.mockReset();
    resetModelCardClientCacheForTests();
  });

  describe('resolve', () => {
    it('returns resolved items for valid pairs', async () => {
      const resolveResponse: ModelCardResolveResponse = {
        resolved: [
          {
            provider: 'openai',
            model: 'gpt-4o',
            status: 'resolved',
            match_strategy: 'exact',
            card: {
              model_key: 'openrouter:openai/gpt-4o',
              source_model_id: 'openai/gpt-4o',
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

      const client = mockClient({
        resolve: jest.fn().mockResolvedValue(resolveResponse),
      });

      const result = await client.resolve([{ provider: 'openai', model: 'gpt-4o' }]);
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].status).toBe('resolved');
      expect(result.resolved[0].card?.pricing.prompt_usd_per_token).toBe(0.0025);
    });

    it('returns unresolved items for unknown models', async () => {
      const resolveResponse: ModelCardResolveResponse = {
        resolved: [
          {
            provider: 'unknown',
            model: 'fake-model',
            status: 'unresolved',
            reason: 'not_found',
          },
        ],
        freshness: {
          catalog_last_refreshed_at: null,
          stale: true,
          soft_stale: true,
          hard_stale: false,
          source_path: 'snapshot_fallback',
        },
      };

      const client = mockClient({
        resolve: jest.fn().mockResolvedValue(resolveResponse),
      });

      const result = await client.resolve([{ provider: 'unknown', model: 'fake-model' }]);
      expect(result.resolved[0].status).toBe('unresolved');
      expect(result.resolved[0].reason).toBe('not_found');
      expect(result.resolved[0].card).toBeUndefined();
    });
  });

  describe('lookup', () => {
    it('returns full model card by model_key', async () => {
      const lookupResponse: ModelCardLookupResponse = {
        data: testCard,
        freshness: {
          catalog_last_refreshed_at: '2026-03-03T00:00:00Z',
          stale: false,
          soft_stale: false,
          hard_stale: false,
          source_path: 'memory_live',
        },
      };

      const client = mockClient({
        lookup: jest.fn().mockResolvedValue(lookupResponse),
      });

      const result = await client.lookup({ modelKey: 'openrouter:openai/gpt-4o' });
      expect(result.data.model_key).toBe('openrouter:openai/gpt-4o');
      expect(result.data.name).toBe('GPT-4o');
      expect(result.data.context_length).toBe(128000);
      expect(result.data.pricing.prompt_usd_per_token).toBe(0.0025);
      expect(result.data.top_provider.max_completion_tokens).toBe(16384);
    });

    it('propagates errors from the backend', async () => {
      const client = mockClient({
        lookup: jest.fn().mockRejectedValue(new Error('model card not found')),
      });

      await expect(client.lookup({ modelKey: 'nonexistent' })).rejects.toThrow('model card not found');
    });
  });

  describe('default client cache TTL', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('evicts resolve cache entries after TTL and re-fetches', async () => {
      const resolveResponse: ModelCardResolveResponse = {
        resolved: [
          {
            provider: 'openai',
            model: 'gpt-4o',
            status: 'resolved',
            match_strategy: 'exact',
            card: {
              model_key: 'openrouter:openai/gpt-4o',
              source_model_id: 'openai/gpt-4o',
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

      backendFetchMock.mockReturnValue(of({ data: resolveResponse }));

      await defaultModelCardClient.resolve([{ provider: 'openai', model: 'gpt-4o' }]);
      expect(backendFetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(5 * 60 * 1000);

      await defaultModelCardClient.resolve([{ provider: 'openai', model: 'gpt-4o' }]);
      expect(backendFetchMock).toHaveBeenCalledTimes(2);
    });

    it('evicts lookup cache entries after TTL and re-fetches', async () => {
      const lookupResponse: ModelCardLookupResponse = {
        data: testCard,
        freshness: {
          catalog_last_refreshed_at: '2026-03-03T00:00:00Z',
          stale: false,
          soft_stale: false,
          hard_stale: false,
          source_path: 'memory_live',
        },
      };

      backendFetchMock.mockReturnValue(of({ data: lookupResponse }));

      await defaultModelCardClient.lookup({ modelKey: 'openrouter:openai/gpt-4o' });
      expect(backendFetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(5 * 60 * 1000);

      await defaultModelCardClient.lookup({ modelKey: 'openrouter:openai/gpt-4o' });
      expect(backendFetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('default client caching', () => {
    it('deduplicates identical resolve requests', async () => {
      const resolveResponse: ModelCardResolveResponse = {
        resolved: [
          {
            provider: 'openai',
            model: 'gpt-4o',
            status: 'resolved',
            match_strategy: 'exact',
            card: {
              model_key: 'openrouter:openai/gpt-4o',
              source_model_id: 'openai/gpt-4o',
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

      backendFetchMock.mockReturnValue(of({ data: resolveResponse }));

      const [first, second] = await Promise.all([
        defaultModelCardClient.resolve([{ provider: 'openai', model: 'gpt-4o' }]),
        defaultModelCardClient.resolve([{ provider: 'openai', model: 'gpt-4o' }]),
      ]);

      expect(first).toEqual(resolveResponse);
      expect(second).toEqual(resolveResponse);
      expect(backendFetchMock).toHaveBeenCalledTimes(1);
      expect(backendFetchMock).toHaveBeenCalledWith({
        method: 'GET',
        url: '/api/plugins/grafana-sigil-app/resources/query/model-cards?resolve_pair=openai%3Agpt-4o',
      });
    });

    it('deduplicates identical lookup requests', async () => {
      const lookupResponse: ModelCardLookupResponse = {
        data: testCard,
        freshness: {
          catalog_last_refreshed_at: '2026-03-03T00:00:00Z',
          stale: false,
          soft_stale: false,
          hard_stale: false,
          source_path: 'memory_live',
        },
      };

      backendFetchMock.mockReturnValue(of({ data: lookupResponse }));

      const [first, second] = await Promise.all([
        defaultModelCardClient.lookup({ modelKey: 'openrouter:openai/gpt-4o' }),
        defaultModelCardClient.lookup({ modelKey: 'openrouter:openai/gpt-4o' }),
      ]);

      expect(first).toEqual(lookupResponse);
      expect(second).toEqual(lookupResponse);
      expect(backendFetchMock).toHaveBeenCalledTimes(1);
      expect(backendFetchMock).toHaveBeenCalledWith({
        method: 'GET',
        url: '/api/plugins/grafana-sigil-app/resources/query/model-cards/lookup?model_key=openrouter%3Aopenai%2Fgpt-4o',
      });
    });
  });
});
