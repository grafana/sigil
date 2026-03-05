import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  ConversationDetail,
  ConversationListResponse,
  GenerationLookupHints,
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
  listConversations?: () => Promise<ConversationListResponse>;
  searchConversations: (request: ConversationSearchRequest) => Promise<ConversationSearchResponse>;
  getConversationDetail: (conversationID: string) => Promise<ConversationDetail>;
  getGeneration: (generationID: string, hints?: GenerationLookupHints) => Promise<GenerationDetail>;
  getSearchTags: (from: string, to: string) => Promise<SearchTag[]>;
  getSearchTagValues: (tag: string, from: string, to: string) => Promise<string[]>;
};

export const defaultConversationsDataSource: ConversationsDataSource = {
  async listConversations() {
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationListResponse>({
        method: 'GET',
        url: `${queryBasePath}/conversations`,
      })
    );
    return response.data;
  },

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

  async getGeneration(generationID, hints) {
    const query = new URLSearchParams();
    if (hints?.conversation_id) {
      query.set('conversation_id', hints.conversation_id);
    }
    if (hints?.from) {
      query.set('from', hints.from);
    }
    if (hints?.to) {
      query.set('to', hints.to);
    }
    if (hints?.at) {
      query.set('at', hints.at);
    }
    const path =
      query.toString().length > 0
        ? `${queryBasePath}/generations/${encodeURIComponent(generationID)}?${query.toString()}`
        : `${queryBasePath}/generations/${encodeURIComponent(generationID)}`;
    const response = await lastValueFrom(
      getBackendSrv().fetch<GenerationDetail>({
        method: 'GET',
        url: path,
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
