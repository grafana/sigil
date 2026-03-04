import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type { AgentDetail, AgentListResponse, AgentVersionListResponse } from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

export type AgentsDataSource = {
  listAgents: (limit?: number, cursor?: string, namePrefix?: string) => Promise<AgentListResponse>;
  lookupAgent: (name: string, version?: string) => Promise<AgentDetail>;
  listAgentVersions: (name: string, limit?: number, cursor?: string) => Promise<AgentVersionListResponse>;
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
};
