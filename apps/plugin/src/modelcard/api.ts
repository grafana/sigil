import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type { ModelCardLookupResponse, ModelCardResolveResponse, ModelResolvePair } from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

export type ModelCardLookupParams = {
  modelKey?: string;
  source?: string;
  sourceModelID?: string;
};

export type ModelCardClient = {
  resolve: (pairs: ModelResolvePair[]) => Promise<ModelCardResolveResponse>;
  lookup: (params: ModelCardLookupParams) => Promise<ModelCardLookupResponse>;
};

export const defaultModelCardClient: ModelCardClient = {
  async resolve(pairs) {
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
  },

  async lookup(params) {
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
  },
};
