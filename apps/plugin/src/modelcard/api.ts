import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type { ModelCardLookupResponse, ModelCardResolveResponse, ModelResolvePair } from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

const CACHE_TTL_MS = 5 * 60 * 1000;

const resolveCache = new Map<string, Promise<ModelCardResolveResponse>>();
const lookupCache = new Map<string, Promise<ModelCardLookupResponse>>();

export type ModelCardLookupParams = {
  modelKey?: string;
  source?: string;
  sourceModelID?: string;
};

export type ModelCardClient = {
  resolve: (pairs: ModelResolvePair[]) => Promise<ModelCardResolveResponse>;
  lookup: (params: ModelCardLookupParams) => Promise<ModelCardLookupResponse>;
};

function buildResolveCacheKey(pairs: ModelResolvePair[]): string {
  const normalized = pairs
    .map((pair) => ({
      provider: pair.provider.trim().toLowerCase(),
      model: pair.model.trim(),
    }))
    .sort((left, right) =>
      left.provider === right.provider
        ? left.model.localeCompare(right.model)
        : left.provider.localeCompare(right.provider)
    );
  return JSON.stringify(normalized);
}

function buildLookupCacheKey(params: ModelCardLookupParams): string {
  return JSON.stringify({
    modelKey: params.modelKey?.trim() ?? '',
    source: params.source?.trim() ?? '',
    sourceModelID: params.sourceModelID?.trim() ?? '',
  });
}

export function resetModelCardClientCacheForTests(): void {
  resolveCache.clear();
  lookupCache.clear();
}

export const defaultModelCardClient: ModelCardClient = {
  async resolve(pairs) {
    const cacheKey = buildResolveCacheKey(pairs);
    const existing = resolveCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const query = new URLSearchParams();
      for (const pair of pairs) {
        query.append('resolve_pair', `${pair.provider}:${pair.model}`);
      }
      const response = await lastValueFrom(
        getBackendSrv().fetch<ModelCardResolveResponse>({
          method: 'GET',
          url: `${queryBasePath}/model-cards?${query.toString()}`,
        })
      );
      return response.data;
    })().catch((error) => {
      resolveCache.delete(cacheKey);
      throw error;
    });

    resolveCache.set(cacheKey, promise);
    setTimeout(() => resolveCache.delete(cacheKey), CACHE_TTL_MS);
    return promise;
  },

  async lookup(params) {
    const cacheKey = buildLookupCacheKey(params);
    const existing = lookupCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const query = new URLSearchParams();
      if (params.modelKey) {
        query.set('model_key', params.modelKey);
      }
      if (params.source) {
        query.set('source', params.source);
      }
      if (params.sourceModelID) {
        query.set('source_model_id', params.sourceModelID);
      }
      const response = await lastValueFrom(
        getBackendSrv().fetch<ModelCardLookupResponse>({
          method: 'GET',
          url: `${queryBasePath}/model-cards/lookup?${query.toString()}`,
        })
      );
      return response.data;
    })().catch((error) => {
      lookupCache.delete(cacheKey);
      throw error;
    });

    lookupCache.set(cacheKey, promise);
    setTimeout(() => lookupCache.delete(cacheKey), CACHE_TTL_MS);
    return promise;
  },
};
