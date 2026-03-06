import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  AgentDetail,
  AgentListResponse,
  AgentRatingRequest,
  AgentRatingResponse,
  AgentVersionListResponse,
} from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

export type AgentsDataSource = {
  listAgents: (limit?: number, cursor?: string, namePrefix?: string) => Promise<AgentListResponse>;
  lookupAgent: (name: string, version?: string) => Promise<AgentDetail>;
  listAgentVersions: (name: string, limit?: number, cursor?: string) => Promise<AgentVersionListResponse>;
  lookupAgentRating: (name: string, version?: string) => Promise<AgentRatingResponse | null>;
  rateAgent: (name: string, version?: string) => Promise<AgentRatingResponse>;
};

export const defaultAgentsDataSource: AgentsDataSource = {
  async listAgents(limit?: number, cursor?: string, namePrefix?: string) {
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
