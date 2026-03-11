import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { plugin } from '../module';
import { canonicalizeConversationFilterKey } from './filterKeyMapping';
import type {
  ConversationDetail,
  ConversationListResponse,
  GenerationLookupHints,
  CreateConversationRatingRequest,
  CreateConversationRatingResponse,
  ConversationSearchRequest,
  ConversationSearchResponse,
  ConversationStatsRequest,
  ConversationStatsResponse,
  ConversationRatingsListResponse,
  GenerationDetail,
  SearchTag,
  SearchTagValuesResponse,
  SearchTagsResponse,
} from './types';
import { hydrateConversationDetailV2, type ConversationDetailV2 } from './detailV2';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';
function getTempoDatasourceUID(): string | undefined {
  return (plugin.meta.jsonData as { tempoDatasourceUID?: string } | undefined)?.tempoDatasourceUID?.trim() || undefined;
}

type ConversationSearchStreamEvent =
  | { type: 'results'; conversations?: ConversationSearchResponse['conversations'] }
  | { type: 'complete'; next_cursor?: string; has_more: boolean }
  | { type: 'error'; message?: string };

export type ConversationSearchStreamOptions = {
  signal?: AbortSignal;
  onResults: (conversations: ConversationSearchResponse['conversations']) => void;
  onComplete: (response: Pick<ConversationSearchResponse, 'next_cursor' | 'has_more'>) => void;
};

function isConversationDetailV2(detail: ConversationDetail | ConversationDetailV2): detail is ConversationDetailV2 {
  if ('shared' in detail) {
    return true;
  }

  const firstGeneration = detail.generations[0] as
    | {
        input_refs?: number[];
        output_refs?: number[];
        tool_refs?: number[];
        system_prompt_ref?: number;
        metadata_ref?: number;
      }
    | undefined;

  return Boolean(
    firstGeneration &&
    ('input_refs' in firstGeneration ||
      'output_refs' in firstGeneration ||
      'tool_refs' in firstGeneration ||
      'system_prompt_ref' in firstGeneration ||
      'metadata_ref' in firstGeneration)
  );
}

function toUnixSeconds(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return '';
  }
  return String(Math.floor(parsed / 1000));
}

function normalizeTempoSearchTagKey(scope: 'span' | 'resource', key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.startsWith('span.') || trimmed.startsWith('resource.')) {
    return canonicalizeConversationFilterKey(trimmed);
  }
  return canonicalizeConversationFilterKey(`${scope}.${trimmed}`);
}

function dedupeSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function parseTempoSearchTagsResponse(payload: unknown, fallbackScope: 'span' | 'resource'): SearchTag[] {
  const tags: SearchTag[] = [];
  const seen = new Set<string>();

  const addTag = (key: string, scope: 'span' | 'resource') => {
    const normalizedKey = normalizeTempoSearchTagKey(scope, key);
    if (!normalizedKey || seen.has(normalizedKey)) {
      return;
    }
    seen.add(normalizedKey);
    tags.push({ key: normalizedKey, scope });
  };

  if (!payload || typeof payload !== 'object') {
    return tags;
  }

  const record = payload as {
    scopes?: Array<{ name?: string; tags?: Array<{ name?: string } | string> }>;
    tagNames?: string[];
    tags?: string[];
  };

  if (Array.isArray(record.scopes)) {
    for (const scopeEntry of record.scopes) {
      const scopeName = scopeEntry?.name === 'resource' ? 'resource' : scopeEntry?.name === 'span' ? 'span' : null;
      if (!scopeName || !Array.isArray(scopeEntry.tags)) {
        continue;
      }
      for (const rawTag of scopeEntry.tags) {
        if (typeof rawTag === 'string') {
          addTag(rawTag, scopeName);
          continue;
        }
        if (rawTag && typeof rawTag === 'object' && typeof rawTag.name === 'string') {
          addTag(rawTag.name, scopeName);
        }
      }
    }
  }

  if (tags.length > 0) {
    return tags.sort((left, right) => left.key.localeCompare(right.key));
  }

  if (Array.isArray(record.tagNames)) {
    for (const key of record.tagNames) {
      addTag(key, fallbackScope);
    }
  }
  if (Array.isArray(record.tags)) {
    for (const key of record.tags) {
      addTag(key, fallbackScope);
    }
  }

  return tags.sort((left, right) => left.key.localeCompare(right.key));
}

function parseTempoSearchTagValuesResponse(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as { values?: unknown; tagValues?: unknown };
  const candidates = [record.values, record.tagValues];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const normalizedValues = candidate.flatMap((value) => {
        if (typeof value === 'string') {
          return [value];
        }
        if (
          value &&
          typeof value === 'object' &&
          'value' in value &&
          typeof (value as { value?: unknown }).value === 'string'
        ) {
          return [(value as { value: string }).value];
        }
        return [];
      });
      return dedupeSortedStrings(normalizedValues);
    }
  }

  return [];
}

async function fetchTempoSearchTagsDirect(from: string, to: string, query?: string): Promise<SearchTag[] | null> {
  const uid = getTempoDatasourceUID();
  if (!uid) {
    return null;
  }

  const params = new URLSearchParams();
  const start = toUnixSeconds(from);
  const end = toUnixSeconds(to);
  if (start.length > 0) {
    params.set('start', start);
  }
  if (end.length > 0) {
    params.set('end', end);
  }
  const trimmedQuery = query?.trim();
  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  }

  const [spanResponse, resourceResponse] = await Promise.all([
    lastValueFrom(
      getBackendSrv().fetch<unknown>({
        method: 'GET',
        url: `/api/datasources/proxy/uid/${uid}/api/v2/search/tags?${new URLSearchParams({
          ...Object.fromEntries(params.entries()),
          scope: 'span',
        }).toString()}`,
      })
    ),
    lastValueFrom(
      getBackendSrv().fetch<unknown>({
        method: 'GET',
        url: `/api/datasources/proxy/uid/${uid}/api/v2/search/tags?${new URLSearchParams({
          ...Object.fromEntries(params.entries()),
          scope: 'resource',
        }).toString()}`,
      })
    ),
  ]);

  const spanTags = parseTempoSearchTagsResponse(spanResponse.data, 'span');
  const resourceTags = parseTempoSearchTagsResponse(resourceResponse.data, 'resource');
  const seen = new Set<string>();
  const merged: SearchTag[] = [];
  for (const tag of [...spanTags, ...resourceTags]) {
    if (!seen.has(tag.key)) {
      seen.add(tag.key);
      merged.push(tag);
    }
  }
  return merged.sort((left, right) => left.key.localeCompare(right.key));
}

async function fetchTempoSearchTagValuesDirect(
  tag: string,
  from: string,
  to: string,
  query?: string
): Promise<string[] | null> {
  const uid = getTempoDatasourceUID();
  if (!uid) {
    return null;
  }

  const params = new URLSearchParams();
  const start = toUnixSeconds(from);
  const end = toUnixSeconds(to);
  if (start.length > 0) {
    params.set('start', start);
  }
  if (end.length > 0) {
    params.set('end', end);
  }
  const trimmedQuery = query?.trim();
  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  }

  const response = await lastValueFrom(
    getBackendSrv().fetch<unknown>({
      method: 'GET',
      url: `/api/datasources/proxy/uid/${uid}/api/v2/search/tag/${encodeURIComponent(tag)}/values?${params.toString()}`,
    })
  );

  return parseTempoSearchTagValuesResponse(response.data);
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
  listConversationRatings?: (
    conversationID: string,
    limit?: number,
    cursor?: string
  ) => Promise<ConversationRatingsListResponse>;
  createConversationRating?: (
    conversationID: string,
    request: CreateConversationRatingRequest
  ) => Promise<CreateConversationRatingResponse>;
  getGeneration: (generationID: string, hints?: GenerationLookupHints) => Promise<GenerationDetail>;
  getSearchTags: (from: string, to: string, query?: string) => Promise<SearchTag[]>;
  getSearchTagValues: (tag: string, from: string, to: string, query?: string) => Promise<string[]>;
};

export type FollowupRequest = {
  generation_id: string;
  message: string;
  model?: string;
};

export type FollowupResponse = {
  response: string;
  model: string;
};

export async function followupGeneration(conversationId: string, request: FollowupRequest): Promise<FollowupResponse> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<FollowupResponse>({
      method: 'POST',
      url: `${queryBasePath}/conversations/${encodeURIComponent(conversationId)}/followup`,
      data: request,
    })
  );
  return response.data;
}

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
    const params = new URLSearchParams({ format: 'v2' });
    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationDetail | ConversationDetailV2>({
        method: 'GET',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}?${params.toString()}`,
      })
    );
    return isConversationDetailV2(response.data) ? hydrateConversationDetailV2(response.data) : response.data;
  },

  async listConversationRatings(conversationID, limit = 10, cursor) {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor && cursor.length > 0) {
      params.set('cursor', cursor);
    }

    const response = await lastValueFrom(
      getBackendSrv().fetch<ConversationRatingsListResponse>({
        method: 'GET',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}/ratings?${params.toString()}`,
      })
    );
    return response.data;
  },

  async createConversationRating(conversationID, request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<CreateConversationRatingResponse>({
        method: 'POST',
        url: `${queryBasePath}/conversations/${encodeURIComponent(conversationID)}/ratings`,
        data: request,
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

  async getSearchTags(from, to, query) {
    try {
      const directTags = await fetchTempoSearchTagsDirect(from, to, query);
      if (directTags) {
        return directTags;
      }
    } catch {}

    const params = new URLSearchParams();
    const start = toUnixSeconds(from);
    const end = toUnixSeconds(to);
    if (start.length > 0) {
      params.set('start', start);
    }
    if (end.length > 0) {
      params.set('end', end);
    }
    const trimmedQuery = query?.trim();
    if (trimmedQuery) {
      params.set('q', trimmedQuery);
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

  async getSearchTagValues(tag, from, to, query) {
    try {
      const directValues = await fetchTempoSearchTagValuesDirect(tag, from, to, query);
      if (directValues) {
        return directValues;
      }
    } catch {}

    const params = new URLSearchParams();
    const start = toUnixSeconds(from);
    const end = toUnixSeconds(to);
    if (start.length > 0) {
      params.set('start', start);
    }
    if (end.length > 0) {
      params.set('end', end);
    }
    const trimmedQuery = query?.trim();
    if (trimmedQuery) {
      params.set('q', trimmedQuery);
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
