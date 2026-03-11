import { ReadableStream } from 'node:stream/web';
import { of, throwError } from 'rxjs';

jest.mock('../module', () => ({
  plugin: {
    meta: {
      jsonData: {
        tempoDatasourceUID: 'tempo-uid',
      },
    },
  },
}));

import { defaultConversationsDataSource } from './api';
import type { ConversationSearchRequest, ConversationSearchResponse, ConversationStatsRequest } from './types';
import type { ConversationDetailV2 } from './detailV2';

const backendFetchMock = jest.fn();
const browserFetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({
    fetch: backendFetchMock,
  }),
}));

describe('defaultConversationsDataSource', () => {
  const request: ConversationSearchRequest = {
    filters: 'model = "gpt-4o"',
    select: [],
    time_range: { from: '2025-02-15T07:00:00Z', to: '2025-02-15T10:00:00Z' },
    page_size: 20,
  };

  const response: ConversationSearchResponse = {
    conversations: [
      {
        conversation_id: 'conv-1',
        generation_count: 1,
        first_generation_at: '2025-02-15T08:00:00Z',
        last_generation_at: '2025-02-15T08:05:00Z',
        models: ['gpt-4o'],
        agents: ['assistant'],
        error_count: 0,
        has_errors: false,
        trace_ids: ['trace-1'],
        annotation_count: 0,
      },
    ],
    next_cursor: '',
    has_more: false,
  };
  const statsRequest: ConversationStatsRequest = {
    filters: request.filters,
    time_range: request.time_range,
  };

  beforeEach(() => {
    backendFetchMock.mockReset();
    browserFetchMock.mockReset();
    global.fetch = browserFetchMock as typeof fetch;
  });

  function buildResponse(body: string, status = 200): Response {
    const encoder = new TextEncoder();
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 404 ? 'Not Found' : '',
      body:
        body.length > 0
          ? new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(body));
                controller.close();
              },
            })
          : null,
      text: async () => body,
    } as Response;
  }

  it('searchConversations posts the JSON route', async () => {
    backendFetchMock.mockReturnValue(of({ data: response }));

    await defaultConversationsDataSource.searchConversations(request);

    expect(backendFetchMock).toHaveBeenCalledWith({
      method: 'POST',
      url: '/api/plugins/grafana-sigil-app/resources/query/conversations/search',
      data: request,
    });
  });

  it('streamSearchConversations parses NDJSON frames', async () => {
    browserFetchMock.mockResolvedValue(
      buildResponse(
        '{"type":"results","conversations":[{"conversation_id":"conv-1","generation_count":1,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T08:05:00Z","models":["gpt-4o"],"agents":["assistant"],"error_count":0,"has_errors":false,"trace_ids":["trace-1"],"annotation_count":0}]}\n{"type":"complete","has_more":true,"next_cursor":"cursor-1"}\n'
      )
    );

    const onResults = jest.fn();
    const onComplete = jest.fn();
    await defaultConversationsDataSource.streamSearchConversations!(request, { onResults, onComplete });

    expect(browserFetchMock).toHaveBeenCalledWith(
      '/api/plugins/grafana-sigil-app/resources/query/conversations/search/stream',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        signal: undefined,
      })
    );
    expect(onResults).toHaveBeenCalledWith(response.conversations);
    expect(onComplete).toHaveBeenCalledWith({ next_cursor: 'cursor-1', has_more: true });
  });

  it('streamSearchConversations falls back to JSON search when stream route is unavailable', async () => {
    browserFetchMock.mockResolvedValue(buildResponse('', 404));
    backendFetchMock.mockReturnValue(of({ data: response }));

    const onResults = jest.fn();
    const onComplete = jest.fn();
    await defaultConversationsDataSource.streamSearchConversations!(request, { onResults, onComplete });

    expect(backendFetchMock).toHaveBeenCalledWith({
      method: 'POST',
      url: '/api/plugins/grafana-sigil-app/resources/query/conversations/search',
      data: request,
    });
    expect(onResults).toHaveBeenCalledWith(response.conversations);
    expect(onComplete).toHaveBeenCalledWith({ next_cursor: '', has_more: false });
  });

  it('getConversationStats posts the stats route', async () => {
    backendFetchMock.mockReturnValue(
      of({
        data: {
          totalConversations: 2,
          totalTokens: 120,
          avgCallsPerConversation: 1.5,
          activeLast7d: 2,
          ratedConversations: 1,
          badRatedPct: 0,
        },
      })
    );

    await defaultConversationsDataSource.getConversationStats!(statsRequest);

    expect(backendFetchMock).toHaveBeenCalledWith({
      method: 'POST',
      url: '/api/plugins/grafana-sigil-app/resources/query/conversations/stats',
      data: statsRequest,
    });
  });

  it('getConversationDetail fetches the V2 route and hydrates the response', async () => {
    const detail: ConversationDetailV2 = {
      conversation_id: 'conv-1',
      generation_count: 1,
      first_generation_at: '2026-03-10T09:00:00Z',
      last_generation_at: '2026-03-10T09:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          input_refs: [0],
          output_refs: [1],
          tool_refs: [0],
          system_prompt_ref: 0,
          metadata_ref: 0,
        },
      ],
      annotations: [],
      shared: {
        messages: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'hello' }] },
          { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'hi' }] },
        ],
        tools: [{ name: 'web_search', description: 'Search the web' }],
        system_prompts: ['You are a helpful assistant.'],
        metadata: [{ topic: 'greeting' }],
      },
    };
    backendFetchMock.mockReturnValue(of({ data: detail }));

    const response = await defaultConversationsDataSource.getConversationDetail('conv-1');

    expect(backendFetchMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/plugins/grafana-sigil-app/resources/query/conversations/conv-1?format=v2',
    });
    expect(response).toEqual({
      conversation_id: 'conv-1',
      generation_count: 1,
      first_generation_at: '2026-03-10T09:00:00Z',
      last_generation_at: '2026-03-10T09:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'hello' }] }],
          output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'hi' }] }],
          tools: [{ name: 'web_search', description: 'Search the web' }],
          system_prompt: 'You are a helpful assistant.',
          metadata: { topic: 'greeting' },
        },
      ],
      annotations: [],
    });
  });

  it('accepts legacy conversation detail payloads when format=v2 is ignored', async () => {
    const detail = {
      conversation_id: 'conv-1',
      generation_count: 1,
      first_generation_at: '2026-03-10T09:00:00Z',
      last_generation_at: '2026-03-10T09:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'hello' }] }],
          output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'hi' }] }],
        },
      ],
      annotations: [],
    };
    backendFetchMock.mockReturnValue(of({ data: detail }));

    const response = await defaultConversationsDataSource.getConversationDetail('conv-1');

    expect(response).toEqual(detail);
  });

  it('getSearchTags forwards the optional scoped TraceQL query to the Tempo datasource proxy', async () => {
    backendFetchMock
      .mockReturnValueOnce(of({ data: { tagNames: ['gen_ai.operation.name'] } }))
      .mockReturnValueOnce(of({ data: { tagNames: ['k8s.namespace.name'] } }));

    const tags = await defaultConversationsDataSource.getSearchTags(
      '2025-02-15T07:00:00Z',
      '2025-02-15T10:00:00Z',
      '{ span.gen_ai.conversation.id != "" }'
    );

    expect(tags).toEqual([
      { key: 'resource.k8s.namespace.name', scope: 'resource' },
      { key: 'span.gen_ai.operation.name', scope: 'span' },
    ]);
    expect(backendFetchMock).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: '/api/datasources/proxy/uid/tempo-uid/api/v2/search/tags?start=1739602800&end=1739613600&q=%7B+span.gen_ai.conversation.id+%21%3D+%22%22+%7D&scope=span',
    });
    expect(backendFetchMock).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: '/api/datasources/proxy/uid/tempo-uid/api/v2/search/tags?start=1739602800&end=1739613600&q=%7B+span.gen_ai.conversation.id+%21%3D+%22%22+%7D&scope=resource',
    });
  });

  it('getSearchTagValues forwards the optional scoped TraceQL query to the Tempo datasource proxy', async () => {
    backendFetchMock.mockReturnValue(of({ data: { values: ['prod'] } }));

    const values = await defaultConversationsDataSource.getSearchTagValues(
      'resource.k8s.namespace.name',
      '2025-02-15T07:00:00Z',
      '2025-02-15T10:00:00Z',
      '{ span.gen_ai.conversation.id != "" }'
    );

    expect(values).toEqual(['prod']);
    expect(backendFetchMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/datasources/proxy/uid/tempo-uid/api/v2/search/tag/resource.k8s.namespace.name/values?start=1739602800&end=1739613600&q=%7B+span.gen_ai.conversation.id+%21%3D+%22%22+%7D',
    });
  });

  it('canonicalizes alias-like tag names from Tempo to concrete resource keys', async () => {
    backendFetchMock
      .mockReturnValueOnce(of({ data: { tagNames: [] } }))
      .mockReturnValueOnce(of({ data: { tagNames: ['namespace', 'cluster', 'service'] } }));

    const tags = await defaultConversationsDataSource.getSearchTags(
      '2025-02-15T07:00:00Z',
      '2025-02-15T10:00:00Z',
      '{ span.gen_ai.conversation.id != "" }'
    );

    expect(tags).toEqual([
      { key: 'resource.k8s.cluster.name', scope: 'resource' },
      { key: 'resource.k8s.namespace.name', scope: 'resource' },
      { key: 'resource.service.name', scope: 'resource' },
    ]);
  });

  it('normalizes structured Tempo tagValues objects from the datasource proxy', async () => {
    backendFetchMock.mockReturnValue(
      of({
        data: {
          tagValues: [
            { type: 'string', value: 'assistant' },
            { type: 'string', value: 'worker' },
          ],
        },
      })
    );

    const values = await defaultConversationsDataSource.getSearchTagValues(
      'span.gen_ai.agent.name',
      '2025-02-15T07:00:00Z',
      '2025-02-15T10:00:00Z',
      '{ span.gen_ai.conversation.id != "" }'
    );

    expect(values).toEqual(['assistant', 'worker']);
  });

  it('falls back to the plugin resource route when the direct Tempo proxy fails', async () => {
    backendFetchMock
      .mockReturnValueOnce(throwError(() => new Error('tempo proxy failed')))
      .mockReturnValueOnce(of({ data: { tagNames: [] } }))
      .mockReturnValueOnce(of({ data: { tags: [] } }));

    await defaultConversationsDataSource.getSearchTags(
      '2025-02-15T07:00:00Z',
      '2025-02-15T10:00:00Z',
      '{ span.gen_ai.conversation.id != "" }'
    );

    expect(backendFetchMock).toHaveBeenLastCalledWith({
      method: 'GET',
      url: '/api/plugins/grafana-sigil-app/resources/query/search/tags?start=1739602800&end=1739613600&q=%7B+span.gen_ai.conversation.id+%21%3D+%22%22+%7D',
    });
  });
});
