import { renderHook, waitFor } from '@testing-library/react';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail, ConversationExploreResponse } from '../conversation/types';
import type { ModelCardClient } from '../modelcard/api';
import { useConversationData } from './useConversationData';

function makeDetail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    conversation_id: 'conv-1',
    generation_count: 1,
    first_generation_at: '2026-03-03T10:00:00Z',
    last_generation_at: '2026-03-03T10:05:00Z',
    generations: [],
    annotations: [],
    ...overrides,
  };
}

function makeExploreResponse(overrides: Partial<ConversationExploreResponse> = {}): ConversationExploreResponse {
  return {
    conversation_id: 'conv-1',
    conversation_title: 'Explore title',
    generation_count: 0,
    first_generation_at: '2026-03-03T10:00:00Z',
    last_generation_at: '2026-03-03T10:05:00Z',
    generations: [],
    annotations: [],
    spans: [],
    ...overrides,
  };
}

function makeTracePayload(spans: Array<Record<string, unknown>>) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test-svc' } }] },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

const modelCardClient: ModelCardClient = {
  resolve: jest.fn(async () => ({
    resolved: [],
    freshness: {
      catalog_last_refreshed_at: null,
      stale: false,
      soft_stale: false,
      hard_stale: false,
      source_path: '',
    },
  })),
  lookup: jest.fn(async () => {
    throw new Error('not used');
  }),
};

describe('useConversationData', () => {
  it('prefers the compact explore payload and skips initial Tempo trace fetches', async () => {
    const dataSource: ConversationsDataSource = {
      searchConversations: jest.fn(),
      getConversationDetail: jest.fn(),
      getConversationExplore: jest.fn().mockResolvedValue(
        makeExploreResponse({
          spans: [
            {
              traceID: 'trace-1',
              spanID: 'span-root',
              parentSpanID: '',
              name: 'root',
              startTimeUnixNano: '1000',
              endTimeUnixNano: '2000',
            },
          ],
        })
      ),
      getGeneration: jest.fn(),
      getSearchTags: jest.fn(),
      getSearchTagValues: jest.fn(),
    };
    const traceFetcher = jest.fn();

    const { result } = renderHook(() =>
      useConversationData({
        conversationID: 'conv-1',
        dataSource,
        traceFetcher,
        modelCardClient,
        preferExplorePayload: true,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.conversationData?.conversationTitle).toBe('Explore title');
      expect(result.current.conversationData?.spans).toHaveLength(1);
      expect(result.current.tracesLoading).toBe(false);
    });
    expect(dataSource.getConversationExplore).toHaveBeenCalledWith('conv-1');
    expect(dataSource.getConversationDetail).not.toHaveBeenCalled();
    expect(traceFetcher).not.toHaveBeenCalled();
  });

  it('falls back to detail plus Tempo trace loading when the explore endpoint is unavailable', async () => {
    const dataSource: ConversationsDataSource = {
      searchConversations: jest.fn(),
      getConversationDetail: jest.fn().mockResolvedValue(
        makeDetail({
          generations: [{ generation_id: 'gen-1', conversation_id: 'conv-1', trace_id: 'trace-1', span_id: 'span-1' }],
        })
      ),
      getConversationExplore: jest.fn().mockRejectedValue({ status: 404 }),
      getGeneration: jest.fn(),
      getSearchTags: jest.fn(),
      getSearchTagValues: jest.fn(),
    };
    const traceFetcher = jest.fn().mockResolvedValue(
      makeTracePayload([
        {
          spanId: 'span-1',
          parentSpanId: '',
          name: 'root',
          startTimeUnixNano: '1000',
          endTimeUnixNano: '2000',
        },
      ])
    );

    const { result } = renderHook(() =>
      useConversationData({
        conversationID: 'conv-1',
        dataSource,
        traceFetcher,
        modelCardClient,
        preferExplorePayload: true,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.tracesLoading).toBe(false);
      expect(result.current.conversationData?.spans).toHaveLength(1);
    });

    expect(dataSource.getConversationExplore).toHaveBeenCalledWith('conv-1');
    expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-1');
    expect(traceFetcher).toHaveBeenCalledWith('trace-1');
  });

  it('retries transient explore bootstrap failures before surfacing an error', async () => {
    const dataSource: ConversationsDataSource = {
      searchConversations: jest.fn(),
      getConversationDetail: jest.fn(),
      getConversationExplore: jest
        .fn()
        .mockRejectedValueOnce({ status: 500 })
        .mockResolvedValue(
          makeExploreResponse({
            spans: [
              {
                traceID: 'trace-1',
                spanID: 'span-root',
                parentSpanID: '',
                name: 'root',
                startTimeUnixNano: '1000',
                endTimeUnixNano: '2000',
              },
            ],
          })
        ),
      getGeneration: jest.fn(),
      getSearchTags: jest.fn(),
      getSearchTagValues: jest.fn(),
    };
    const traceFetcher = jest.fn();

    const { result } = renderHook(() =>
      useConversationData({
        conversationID: 'conv-1',
        dataSource,
        traceFetcher,
        modelCardClient,
        preferExplorePayload: true,
      })
    );

    await waitFor(
      () => {
        expect(result.current.loading).toBe(false);
        expect(result.current.errorMessage).toBe('');
        expect(result.current.conversationData?.spans).toHaveLength(1);
      },
      { timeout: 3000 }
    );

    expect(dataSource.getConversationExplore).toHaveBeenCalledTimes(2);
    expect(dataSource.getConversationDetail).not.toHaveBeenCalled();
    expect(traceFetcher).not.toHaveBeenCalled();
  });
});
