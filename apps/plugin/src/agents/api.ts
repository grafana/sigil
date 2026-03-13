import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  AgentDetail,
  AgentRuntimeContextRequest,
  AgentRuntimeContextResponse,
  AgentListResponse,
  AgentSearchRequest,
  AgentRatingRequest,
  AgentRatingResponse,
  AgentVersionListResponse,
  AnalyzePromptRequest,
  PromptInsightsResponse,
} from './types';
import type { SearchTag, SearchTagValuesResponse, SearchTagsResponse } from '../conversation/types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

export type AgentsDataSource = {
  listAgents: (
    limit?: number,
    cursor?: string,
    namePrefix?: string,
    seenAfterSec?: number,
    seenBeforeSec?: number
  ) => Promise<AgentListResponse>;
  searchAgents?: (request: AgentSearchRequest) => Promise<AgentListResponse>;
  lookupAgent: (name: string, version?: string) => Promise<AgentDetail>;
  listAgentVersions: (name: string, limit?: number, cursor?: string) => Promise<AgentVersionListResponse>;
  lookupAgentRating: (name: string, version?: string) => Promise<AgentRatingResponse | null>;
  rateAgent: (name: string, version?: string) => Promise<AgentRatingResponse>;
  lookupPromptInsights: (name: string, version?: string) => Promise<PromptInsightsResponse | null>;
  analyzePrompt: (name: string, version?: string, lookback?: string) => Promise<PromptInsightsResponse>;
  getAgentRuntimeContext?: (request: AgentRuntimeContextRequest) => Promise<AgentRuntimeContextResponse>;
  getSearchTags?: (from: string, to: string) => Promise<SearchTag[]>;
  getSearchTagValues?: (tag: string, from: string, to: string) => Promise<string[]>;
};

function toUnixSeconds(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return '';
  }
  return String(Math.floor(parsed / 1000));
}

export const defaultAgentsDataSource: AgentsDataSource = {
  async listAgents(
    limit?: number,
    cursor?: string,
    namePrefix?: string,
    seenAfterSec?: number,
    seenBeforeSec?: number
  ) {
    const params = new URLSearchParams();
    if (limit != null) {
      params.set('limit', String(limit));
    }
    if (cursor && cursor.length > 0) {
      params.set('cursor', cursor);
    }
    if (namePrefix && namePrefix.length > 0) {
      params.set('name_prefix', namePrefix);
    }
    if (seenAfterSec != null) {
      params.set('seen_after', String(seenAfterSec));
    }
    if (seenBeforeSec != null) {
      params.set('seen_before', String(seenBeforeSec));
    }

    const qs = params.toString();
    const url = qs.length > 0 ? `${queryBasePath}/agents?${qs}` : `${queryBasePath}/agents`;
    const response = await lastValueFrom(getBackendSrv().fetch<AgentListResponse>({ method: 'GET', url }));
    return response.data;
  },

  async lookupAgent(name: string, version?: string) {
    const params = new URLSearchParams();
    params.set('name', name);
    if (version && version.length > 0) {
      params.set('version', version);
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<AgentDetail>({
        method: 'GET',
        url: `${queryBasePath}/agents/lookup?${params.toString()}`,
      })
    );
    return response.data;
  },

  async listAgentVersions(name: string, limit?: number, cursor?: string) {
    const params = new URLSearchParams();
    params.set('name', name);
    if (limit != null) {
      params.set('limit', String(limit));
    }
    if (cursor && cursor.length > 0) {
      params.set('cursor', cursor);
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<AgentVersionListResponse>({
        method: 'GET',
        url: `${queryBasePath}/agents/versions?${params.toString()}`,
      })
    );
    return response.data;
  },

  async lookupAgentRating(name: string, version?: string) {
    const params = new URLSearchParams();
    params.set('name', name);
    if (version && version.length > 0) {
      params.set('version', version);
    }

    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<AgentRatingResponse>({
          method: 'GET',
          url: `${queryBasePath}/agents/rating?${params.toString()}`,
          showErrorAlert: false,
        })
      );
      return response.data;
    } catch (err: unknown) {
      if (extractStatusCode(err) === 404) {
        return null;
      }
      throw err;
    }
  },

  async rateAgent(name: string, version?: string) {
    const payload: AgentRatingRequest = { agent_name: name };
    if (version && version.length > 0) {
      payload.version = version;
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<AgentRatingResponse>({
        method: 'POST',
        url: `${queryBasePath}/agents/rate`,
        data: payload,
      })
    );
    return response.data;
  },

  async lookupPromptInsights(name: string, version?: string) {
    const params = new URLSearchParams();
    params.set('name', name);
    if (version && version.length > 0) {
      params.set('version', version);
    }

    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<PromptInsightsResponse>({
          method: 'GET',
          url: `${queryBasePath}/agents/prompt-insights?${params.toString()}`,
          showErrorAlert: false,
        })
      );
      return response.data;
    } catch (err: unknown) {
      if (extractStatusCode(err) === 404) {
        return null;
      }
      throw err;
    }
  },

  async analyzePrompt(name: string, version?: string, lookback?: string) {
    const payload: AnalyzePromptRequest = { agent_name: name };
    if (version && version.length > 0) {
      payload.version = version;
    }
    if (lookback && lookback.length > 0) {
      payload.lookback = lookback;
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<PromptInsightsResponse>({
        method: 'POST',
        url: `${queryBasePath}/agents/analyze-prompt`,
        data: payload,
      })
    );
    return response.data;
  },

  async searchAgents(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<AgentListResponse>({
        method: 'POST',
        url: `${queryBasePath}/agents/search`,
        data: request,
      })
    );
    return response.data;
  },

  async getAgentRuntimeContext(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<AgentRuntimeContextResponse>({
        method: 'POST',
        url: `${queryBasePath}/agents/runtime-context`,
        data: request,
      })
    );
    return response.data;
  },

  async getSearchTags(from, to) {
    const params = new URLSearchParams();
    const start = toUnixSeconds(from);
    const end = toUnixSeconds(to);
    if (start.length > 0) {
      params.set('start', start);
    }
    if (end.length > 0) {
      params.set('end', end);
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<SearchTagsResponse>({
        method: 'GET',
        url:
          params.toString().length > 0
            ? `${queryBasePath}/search/tags?${params.toString()}`
            : `${queryBasePath}/search/tags`,
      })
    );
    return response.data.tags ?? [];
  },

  async getSearchTagValues(tag, from, to) {
    const params = new URLSearchParams();
    const start = toUnixSeconds(from);
    const end = toUnixSeconds(to);
    if (start.length > 0) {
      params.set('start', start);
    }
    if (end.length > 0) {
      params.set('end', end);
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<SearchTagValuesResponse>({
        method: 'GET',
        url:
          params.toString().length > 0
            ? `${queryBasePath}/search/tag/${encodeURIComponent(tag)}/values?${params.toString()}`
            : `${queryBasePath}/search/tag/${encodeURIComponent(tag)}/values`,
      })
    );
    return response.data.values ?? [];
  },
};

function extractStatusCode(err: unknown): number {
  if (typeof err !== 'object' || err === null) {
    return 0;
  }

  const withStatus = err as { status?: unknown; statusCode?: unknown; data?: { status?: unknown } };
  if (typeof withStatus.status === 'number') {
    return withStatus.status;
  }
  if (typeof withStatus.statusCode === 'number') {
    return withStatus.statusCode;
  }
  if (typeof withStatus.data?.status === 'number') {
    return withStatus.data.status;
  }
  return 0;
}
