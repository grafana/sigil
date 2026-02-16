import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  ConversationDetail,
  ConversationSearchRequest,
  ConversationSearchResponse,
  GenerationDetail,
  SearchTag,
  SearchTagValuesResponse,
  SearchTagsResponse,
} from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

function toUnixSeconds(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return '';
  }
  return String(Math.floor(parsed / 1000));
}

export type ConversationsDataSource = {
  searchConversations: (request: ConversationSearchRequest) => Promise<ConversationSearchResponse>;
  getConversationDetail: (conversationID: string) => Promise<ConversationDetail>;
  getGeneration: (generationID: string) => Promise<GenerationDetail>;
  getSearchTags: (from: string, to: string) => Promise<SearchTag[]>;
  getSearchTagValues: (tag: string, from: string, to: string) => Promise<string[]>;
};

export const defaultConversationsDataSource: ConversationsDataSource = {
  async searchConversations(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationSearchResponse>({
        method: 'POST',
        url: `${queryBasePath}/conversations/search`,
        data: request,
      })
    );
    return response.data;
  },

  async getConversationDetail(conversationID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationDetail>({
        method: 'GET',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}`,
      })
    );
    return response.data;
  },

  async getGeneration(generationID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<GenerationDetail>({
        method: 'GET',
        url: `${queryBasePath}/generations/${encodeURIComponent(generationID)}`,
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
