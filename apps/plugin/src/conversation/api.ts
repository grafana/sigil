import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  ConversationDetail,
  ConversationListResponse,
  GenerationLookupHints,
  ConversationSearchRequest,
  ConversationSearchResponse,
  ConversationStatsRequest,
  ConversationStatsResponse,
  GenerationDetail,
  SearchTag,
  SearchTagValuesResponse,
  SearchTagsResponse,
} from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';

type ConversationSearchStreamEvent =
  | { type: 'results'; conversations?: ConversationSearchResponse['conversations'] }
  | { type: 'complete'; next_cursor?: string; has_more: boolean }
  | { type: 'error'; message?: string };

export type ConversationSearchStreamOptions = {
  signal?: AbortSignal;
  onResults: (conversations: ConversationSearchResponse['conversations']) => void;
  onComplete: (response: Pick<ConversationSearchResponse, 'next_cursor' | 'has_more'>) => void;
};

function toUnixSeconds(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return '';
  }
  return String(Math.floor(parsed / 1000));
}

async function searchConversationsRequest(request: ConversationSearchRequest): Promise<ConversationSearchResponse> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<ConversationSearchResponse>({
      method: 'POST',
      url: `${queryBasePath}/conversations/search`,
      data: request,
    })
  );
  return response.data;
}

async function getConversationStatsRequest(request: ConversationStatsRequest): Promise<ConversationStatsResponse> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<ConversationStatsResponse>({
      method: 'POST',
      url: `${queryBasePath}/conversations/stats`,
      data: request,
    })
  );
  return response.data;
}

function buildSearchStreamRequestInit(request: ConversationSearchRequest, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(request),
    signal,
  };
}

async function buildFetchError(response: Response): Promise<Error> {
  const body = (await response.text()).trim();
  if (body.length > 0) {
    return new Error(body);
  }
  if (response.statusText.length > 0) {
    return new Error(response.statusText);
  }
  return new Error(`request failed with status ${response.status}`);
}

function isStreamingUnavailable(response: Response): boolean {
  return response.status === 404 || response.status === 501;
}

async function fallbackStreamSearch(
  request: ConversationSearchRequest,
  options: ConversationSearchStreamOptions
): Promise<void> {
  const response = await searchConversationsRequest(request);
  options.onResults(response.conversations ?? []);
  options.onComplete({
    next_cursor: response.next_cursor,
    has_more: Boolean(response.has_more),
  });
}

function dispatchConversationSearchStreamEvent(rawLine: string, options: ConversationSearchStreamOptions): void {
  const event = JSON.parse(rawLine) as ConversationSearchStreamEvent;
  switch (event.type) {
    case 'results':
      options.onResults(event.conversations ?? []);
      return;
    case 'complete':
      options.onComplete({
        next_cursor: event.next_cursor,
        has_more: Boolean(event.has_more),
      });
      return;
    case 'error':
      throw new Error(event.message ?? 'conversation search stream failed');
    default:
      throw new Error('conversation search stream returned an unknown event');
  }
}

async function streamSearchConversationsRequest(
  request: ConversationSearchRequest,
  options: ConversationSearchStreamOptions
): Promise<void> {
  if (typeof fetch !== 'function') {
    await fallbackStreamSearch(request, options);
    return;
  }

  const response = await fetch(
    `${queryBasePath}/conversations/search/stream`,
    buildSearchStreamRequestInit(request, options.signal)
  );
  if (isStreamingUnavailable(response)) {
    await fallbackStreamSearch(request, options);
    return;
  }
  if (!response.ok) {
    throw await buildFetchError(response);
  }
  if (response.body == null) {
    await fallbackStreamSearch(request, options);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    for (; newlineIndex >= 0; newlineIndex = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      dispatchConversationSearchStreamEvent(line, options);
    }
  }

  const trailing = `${buffer}${decoder.decode()}`.trim();
  if (trailing.length > 0) {
    dispatchConversationSearchStreamEvent(trailing, options);
  }
}

export type ConversationsDataSource = {
  listConversations?: () => Promise<ConversationListResponse>;
  searchConversations: (request: ConversationSearchRequest) => Promise<ConversationSearchResponse>;
  streamSearchConversations?: (
    request: ConversationSearchRequest,
    options: ConversationSearchStreamOptions
  ) => Promise<void>;
  getConversationStats?: (request: ConversationStatsRequest) => Promise<ConversationStatsResponse>;
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
    return searchConversationsRequest(request);
  },

  async streamSearchConversations(request, options) {
    await streamSearchConversationsRequest(request, options);
  },

  async getConversationStats(request) {
    return getConversationStatsRequest(request);
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
