import { ReadableStream } from 'node:stream/web';
import { of } from 'rxjs';
import { defaultConversationsDataSource } from './api';
import type { ConversationSearchRequest, ConversationSearchResponse, ConversationStatsRequest } from './types';

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
});
