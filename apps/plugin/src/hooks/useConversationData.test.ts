import { act, renderHook, waitFor } from '@testing-library/react';
import type { ConversationsDataSource } from '../conversation/api';
import { useConversationData } from './useConversationData';
import type { ModelCardClient } from '../modelcard/api';

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
  afterEach(() => {
    jest.useRealTimers();
  });

  it('updates conversation data progressively while traces are still loading', async () => {
    let resolveTraceA: ((value: unknown) => void) | undefined;
    let resolveTraceB: ((value: unknown) => void) | undefined;
    const dataSource: ConversationsDataSource = {
      searchConversations: jest.fn(),
      getConversationDetail: jest.fn().mockResolvedValue({
        conversation_id: 'conv-1',
        generation_count: 2,
        first_generation_at: '2026-03-09T13:18:03Z',
        last_generation_at: '2026-03-09T13:28:15Z',
        generations: [
          {
            generation_id: 'gen-a',
            conversation_id: 'conv-1',
            trace_id: 'trace-a',
            span_id: 'span-a',
          },
          {
            generation_id: 'gen-b',
            conversation_id: 'conv-1',
            trace_id: 'trace-b',
            span_id: 'span-b',
          },
        ],
        annotations: [],
      }),
      getGeneration: jest.fn(),
      getSearchTags: jest.fn(),
      getSearchTagValues: jest.fn(),
    };
    const traceFetcher = jest.fn((traceID: string) => {
      return new Promise((resolve) => {
        if (traceID === 'trace-a') {
          resolveTraceA = resolve;
          return;
        }
        resolveTraceB = resolve;
      });
    });

    const { result } = renderHook(() =>
      useConversationData({
        conversationID: 'conv-1',
        dataSource,
        traceFetcher,
        modelCardClient,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.tracesLoading).toBe(true);
      expect(result.current.conversationData?.spans).toHaveLength(0);
    });

    act(() => {
      resolveTraceA?.({
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span-a',
                    parentSpanId: '',
                    name: 'first',
                    startTimeUnixNano: '1000',
                    endTimeUnixNano: '2000',
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.tracesLoading).toBe(true);
      expect(result.current.conversationData?.spans).toHaveLength(1);
      expect(result.current.conversationData?.spans[0].spanID).toBe('span-a');
    });

    act(() => {
      resolveTraceB?.({
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span-b',
                    parentSpanId: '',
                    name: 'second',
                    startTimeUnixNano: '3000',
                    endTimeUnixNano: '4000',
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.tracesLoading).toBe(false);
      expect(result.current.conversationData?.spans).toHaveLength(2);
    });
  });
});
