import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  ConversationAnnotationsResponse,
  ConversationAnnotation,
  ConversationListItem,
  ConversationListResponse,
  ConversationRating,
  ConversationRatingsResponse,
} from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

export type ConversationListFilter = {
  hasBadRating?: boolean;
  hasAnnotations?: boolean;
};

export type ConversationsDataSource = {
  listConversations: (filter: ConversationListFilter) => Promise<ConversationListItem[]>;
  getConversation: (conversationID: string) => Promise<ConversationListItem>;
  listConversationRatings: (conversationID: string, limit?: number) => Promise<ConversationRating[]>;
  listConversationAnnotations: (conversationID: string, limit?: number) => Promise<ConversationAnnotation[]>;
};

export const defaultConversationsDataSource: ConversationsDataSource = {
  async listConversations(filter) {
    const params = new URLSearchParams();
    if (typeof filter.hasBadRating === 'boolean') {
      params.set('has_bad_rating', String(filter.hasBadRating));
    }
    if (typeof filter.hasAnnotations === 'boolean') {
      params.set('has_annotations', String(filter.hasAnnotations));
    }

    const query = params.toString();
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationListResponse>({
        method: 'GET',
        url: query.length > 0 ? `${queryBasePath}/conversations?${query}` : `${queryBasePath}/conversations`,
      })
    );
    return response.data.items ?? [];
  },

  async getConversation(conversationID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationListItem>({
        method: 'GET',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}`,
      })
    );
    return response.data;
  },

  async listConversationRatings(conversationID, limit = 100) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationRatingsResponse>({
        method: 'GET',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}/ratings?limit=${limit}`,
      })
    );
    return response.data.items ?? [];
  },

  async listConversationAnnotations(conversationID, limit = 100) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationAnnotationsResponse>({
        method: 'GET',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}/annotations?limit=${limit}`,
      })
    );
    return response.data.items ?? [];
  },
};
