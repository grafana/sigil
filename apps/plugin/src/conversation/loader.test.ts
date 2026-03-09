import type { ConversationsDataSource } from './api';
import { loadConversation, loadConversationDetail } from './loader';
import type { ConversationDetail } from './types';

function makeDetail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    conversation_id: 'conv-1',
    generation_count: 2,
    first_generation_at: '2026-03-03T10:00:00Z',
    last_generation_at: '2026-03-03T10:05:00Z',
    generations: [],
    annotations: [],
    ...overrides,
  };
}

function makeOTLPPayload(traceID: string, spans: Array<Record<string, unknown>>) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test-svc' } }] },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

function makeDataSource(detail: ConversationDetail): ConversationsDataSource {
  return {
    searchConversations: jest.fn(),
    getConversationDetail: jest.fn().mockResolvedValue(detail),
    getGeneration: jest.fn(),
    getSearchTags: jest.fn(),
    getSearchTagValues: jest.fn(),
  };
}

describe('loadConversation', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('assembles ConversationData from detail + traces', async () => {
    const detail = makeDetail({
      conversation_title: 'Incident: stored title',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          trace_id: 'trace-1',
          span_id: 'span-child',
        },
      ],
    });
    const dataSource = makeDataSource(detail);
    const fetchTrace = jest.fn().mockResolvedValue(
      makeOTLPPayload('trace-1', [
        {
          spanId: 'span-root',
          parentSpanId: '',
          name: 'root',
          startTimeUnixNano: '1000000000',
          endTimeUnixNano: '5000000000',
        },
        {
          spanId: 'span-child',
          parentSpanId: 'span-root',
          name: 'generateText gpt-4o',
          startTimeUnixNano: '2000000000',
          endTimeUnixNano: '3000000000',
          attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'generateText' } }],
        },
      ])
    );

    const result = await loadConversation(dataSource, 'conv-1', fetchTrace);

    expect(result.conversationID).toBe('conv-1');
    expect(result.conversationTitle).toBe('Incident: stored title');
    expect(result.generationCount).toBe(2);
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].spanID).toBe('span-root');
    expect(result.spans[0].children).toHaveLength(1);
    expect(result.spans[0].children[0].generation?.generation_id).toBe('gen-1');
    expect(result.orphanGenerations).toHaveLength(0);
    expect(fetchTrace).toHaveBeenCalledWith('trace-1');
  });

  it('deduplicates trace IDs', async () => {
    const detail = makeDetail({
      generations: [
        { generation_id: 'gen-1', conversation_id: 'conv-1', trace_id: 'trace-1', span_id: 's1' },
        { generation_id: 'gen-2', conversation_id: 'conv-1', trace_id: 'trace-1', span_id: 's2' },
      ],
    });
    const fetchTrace = jest.fn().mockResolvedValue(
      makeOTLPPayload('trace-1', [
        { spanId: 's1', parentSpanId: '', name: 'root', startTimeUnixNano: '1000', endTimeUnixNano: '2000' },
        { spanId: 's2', parentSpanId: 's1', name: 'child', startTimeUnixNano: '1100', endTimeUnixNano: '1500' },
      ])
    );

    await loadConversation(makeDataSource(detail), 'conv-1', fetchTrace);
    expect(fetchTrace).toHaveBeenCalledTimes(1);
  });

  it('handles orphan generations without trace_id', async () => {
    const detail = makeDetail({
      generations: [{ generation_id: 'orphan', conversation_id: 'conv-1' }],
    });
    const fetchTrace = jest.fn();

    const result = await loadConversation(makeDataSource(detail), 'conv-1', fetchTrace);

    expect(result.spans).toHaveLength(0);
    expect(result.orphanGenerations).toHaveLength(1);
    expect(result.orphanGenerations[0].generation_id).toBe('orphan');
    expect(fetchTrace).not.toHaveBeenCalled();
  });

  it('handles trace fetch failures gracefully', async () => {
    const detail = makeDetail({
      generations: [{ generation_id: 'gen-1', conversation_id: 'conv-1', trace_id: 'trace-fail', span_id: 's1' }],
    });
    const fetchTrace = jest.fn().mockRejectedValue(new Error('network error'));

    const result = await loadConversation(makeDataSource(detail), 'conv-1', fetchTrace);

    expect(result.spans).toHaveLength(0);
    expect(result.orphanGenerations).toHaveLength(1);
  });

  it('retries transient conversation detail failures', async () => {
    jest.useFakeTimers();

    const detail = makeDetail({
      generations: [{ generation_id: 'gen-1', conversation_id: 'conv-1' }],
    });
    const dataSource: ConversationsDataSource = {
      searchConversations: jest.fn(),
      getConversationDetail: jest
        .fn()
        .mockRejectedValueOnce({ status: 500, message: 'internal server error' })
        .mockRejectedValueOnce({ status: 502, message: 'bad gateway' })
        .mockResolvedValue(detail),
      getGeneration: jest.fn(),
      getSearchTags: jest.fn(),
      getSearchTagValues: jest.fn(),
    };

    const promise = loadConversationDetail(dataSource, 'conv-1');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(dataSource.getConversationDetail).toHaveBeenCalledTimes(3);
    expect(result.conversationID).toBe('conv-1');
  });

  it('retries empty trace payloads once before leaving the tree empty', async () => {
    jest.useFakeTimers();

    const detail = makeDetail({
      generations: [{ generation_id: 'gen-1', conversation_id: 'conv-1', trace_id: 'trace-1', span_id: 'span-1' }],
    });
    const fetchTrace = jest
      .fn()
      .mockResolvedValueOnce({ trace: {} })
      .mockResolvedValueOnce(
        makeOTLPPayload('trace-1', [
          {
            spanId: 'span-1',
            parentSpanId: '',
            name: 'generateText gpt-4o',
            startTimeUnixNano: '1000',
            endTimeUnixNano: '2000',
            attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'generateText' } }],
          },
        ])
      );

    const promise = loadConversation(makeDataSource(detail), 'conv-1', fetchTrace);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(fetchTrace).toHaveBeenCalledTimes(2);
    expect(result.spans).toHaveLength(1);
    expect(result.orphanGenerations).toHaveLength(0);
  });

  it('merges spans from multiple traces sorted by time', async () => {
    const detail = makeDetail({
      generations: [
        { generation_id: 'g1', conversation_id: 'conv-1', trace_id: 'trace-a', span_id: 'sa' },
        { generation_id: 'g2', conversation_id: 'conv-1', trace_id: 'trace-b', span_id: 'sb' },
      ],
    });
    const fetchTrace = jest.fn().mockImplementation((traceID: string) => {
      if (traceID === 'trace-a') {
        return Promise.resolve(
          makeOTLPPayload('trace-a', [
            { spanId: 'sa', parentSpanId: '', name: 'later', startTimeUnixNano: '5000', endTimeUnixNano: '6000' },
          ])
        );
      }
      return Promise.resolve(
        makeOTLPPayload('trace-b', [
          { spanId: 'sb', parentSpanId: '', name: 'earlier', startTimeUnixNano: '1000', endTimeUnixNano: '2000' },
        ])
      );
    });

    const result = await loadConversation(makeDataSource(detail), 'conv-1', fetchTrace);

    expect(result.spans).toHaveLength(2);
    expect(result.spans[0].name).toBe('earlier');
    expect(result.spans[1].name).toBe('later');
  });
});
