import React from 'react';
import { makeTimeRange } from '@grafana/data';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConversationsPage from './ConversationsPage';
import type { ConversationsDataSource } from '../conversation/api';
import type {
  ConversationDetail,
  ConversationSearchRequest,
  ConversationSearchResponse,
  GenerationDetail,
  SearchTag,
} from '../conversation/types';

let capturedTimeRangeOnChange: ((tr: ReturnType<typeof makeTimeRange>) => void) | undefined;

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    TimeRangePicker: ({ onChange }: { value: unknown; onChange: (tr: unknown) => void }) => {
      capturedTimeRangeOnChange = onChange;
      return <div data-testid="time-range-picker" />;
    },
  };
});

type MockConversationsDataSource = {
  [Key in keyof ConversationsDataSource]: jest.MockedFunction<ConversationsDataSource[Key]>;
};

function buildSearchResponse(
  conversations: ConversationSearchResponse['conversations'],
  nextCursor = '',
  hasMore = false
): ConversationSearchResponse {
  return {
    conversations,
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}

function createDataSource(overrides?: Partial<MockConversationsDataSource>): MockConversationsDataSource {
  const defaultConversationDetail: ConversationDetail = {
    conversation_id: 'conv-1',
    generation_count: 1,
    first_generation_at: '2026-02-15T10:00:00Z',
    last_generation_at: '2026-02-15T10:00:00Z',
    generations: [
      {
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        trace_id: 'trace-1',
        created_at: '2026-02-15T10:00:00Z',
      },
    ],
    annotations: [],
  };

  const defaultGenerationDetail: GenerationDetail = {
    generation_id: 'gen-1',
    conversation_id: 'conv-1',
    trace_id: 'trace-1',
    mode: 'SYNC',
    model: { provider: 'openai', name: 'gpt-4o' },
    input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Hello' }] }],
    output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'Hi there!' }] }],
  };

  const defaultTags: SearchTag[] = [{ key: 'model', scope: 'well-known', description: 'Model name' }];

  return {
    searchConversations: jest.fn(async (_request: ConversationSearchRequest) => buildSearchResponse([])),
    getConversationDetail: jest.fn(async (_conversationID: string) => defaultConversationDetail),
    getGeneration: jest.fn(async (_generationID: string) => defaultGenerationDetail),
    getSearchTags: jest.fn(async (_from: string, _to: string) => defaultTags),
    getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string) => ['gpt-4o']),
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeConversation(id: string, overrides?: Partial<ConversationSearchResponse['conversations'][0]>) {
  return {
    conversation_id: id,
    generation_count: 1,
    first_generation_at: '2026-02-15T09:00:00Z',
    last_generation_at: '2026-02-15T10:00:00Z',
    models: ['gpt-4o'],
    agents: ['assistant'],
    error_count: 0,
    has_errors: false,
    trace_ids: ['trace-1'],
    annotation_count: 0,
    ...overrides,
  };
}

describe('ConversationsPage', () => {
  it('applies filter search and renders conversation detail with chat messages', async () => {
    const dataSource = createDataSource({
      searchConversations: jest.fn(async (_request: ConversationSearchRequest) =>
        buildSearchResponse([makeConversation('conv-1', { generation_count: 2 })])
      ),
    });

    render(<ConversationsPage dataSource={dataSource} />);

    fireEvent.change(screen.getByLabelText('conversation filters'), { target: { value: 'model = "gpt-4o"' } });
    fireEvent.click(screen.getByLabelText('apply filters'));

    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalled());
    expect(await screen.findByLabelText('select conversation conv-1')).toBeInTheDocument();
    await waitFor(() => expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-1'));
    await waitFor(() => expect(dataSource.getGeneration).toHaveBeenCalledWith('gen-1'));
    expect(await screen.findByText('Hi there!')).toBeInTheDocument();
  });

  it('loads more results with cursor pagination', async () => {
    const dataSource = createDataSource({
      searchConversations: jest
        .fn<Promise<ConversationSearchResponse>, [ConversationSearchRequest]>()
        .mockImplementationOnce(async () => buildSearchResponse([makeConversation('conv-1')], 'cursor-1', true))
        .mockImplementationOnce(async (request: ConversationSearchRequest) => {
          if (request.cursor !== 'cursor-1') {
            throw new Error(`expected cursor-1, got ${request.cursor}`);
          }
          return buildSearchResponse([makeConversation('conv-2')]);
        }),
    });

    render(<ConversationsPage dataSource={dataSource} />);

    fireEvent.click(screen.getByLabelText('apply filters'));
    await screen.findByLabelText('select conversation conv-1');

    fireEvent.click(screen.getByLabelText('load more conversations'));
    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('select conversation conv-2')).toBeInTheDocument();
  });

  it('ignores stale search responses when apply is triggered rapidly', async () => {
    const slowSearch = createDeferred<ConversationSearchResponse>();
    const fastSearch = createDeferred<ConversationSearchResponse>();

    const dataSource = createDataSource({
      searchConversations: jest
        .fn<Promise<ConversationSearchResponse>, [ConversationSearchRequest]>()
        .mockImplementationOnce(async () => slowSearch.promise)
        .mockImplementationOnce(async () => fastSearch.promise),
      getConversationDetail: jest.fn(async (conversationID: string) => ({
        conversation_id: conversationID,
        generation_count: 1,
        first_generation_at: '2026-02-15T10:00:00Z',
        last_generation_at: '2026-02-15T10:00:00Z',
        generations: [
          {
            generation_id: `${conversationID}-gen`,
            conversation_id: conversationID,
            trace_id: `${conversationID}-trace`,
            created_at: '2026-02-15T10:00:00Z',
          },
        ],
        annotations: [],
      })),
      getGeneration: jest.fn(async (generationID: string) => ({
        generation_id: generationID,
        conversation_id: generationID.replace(/-gen$/, ''),
        trace_id: `${generationID}-trace`,
        mode: 'SYNC',
        input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'test' }] }],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'response' }] }],
      })),
    });

    render(<ConversationsPage dataSource={dataSource} />);

    fireEvent.change(screen.getByLabelText('conversation filters'), { target: { value: 'model = "slow"' } });
    fireEvent.click(screen.getByLabelText('apply filters'));
    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('conversation filters'), { target: { value: 'model = "fast"' } });
    fireEvent.click(screen.getByLabelText('apply filters'));
    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(2));

    await act(async () => {
      fastSearch.resolve(buildSearchResponse([makeConversation('conv-fast')]));
      await Promise.resolve();
    });

    expect(await screen.findByLabelText('select conversation conv-fast')).toBeInTheDocument();
    await waitFor(() => expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-fast'));

    await act(async () => {
      slowSearch.resolve(buildSearchResponse([makeConversation('conv-slow')]));
      await Promise.resolve();
    });

    expect(screen.queryByLabelText('select conversation conv-slow')).not.toBeInTheDocument();
    expect(dataSource.getConversationDetail).not.toHaveBeenCalledWith('conv-slow');
  });

  it('keeps latest tag suggestions when older tag request resolves last', async () => {
    const slowTags = createDeferred<SearchTag[]>();
    const fastTags = createDeferred<SearchTag[]>();

    const dataSource = createDataSource({
      getSearchTags: jest
        .fn<Promise<SearchTag[]>, [string, string]>()
        .mockImplementationOnce(async () => [{ key: 'initial-tag', scope: 'span' }])
        .mockImplementationOnce(async () => slowTags.promise)
        .mockImplementationOnce(async () => fastTags.promise),
    });

    render(<ConversationsPage dataSource={dataSource} />);
    expect(await screen.findByRole('button', { name: 'initial-tag' })).toBeInTheDocument();

    act(() => {
      capturedTimeRangeOnChange?.(makeTimeRange('2026-02-15T08:00:00Z', '2026-02-16T08:00:00Z'));
    });
    await waitFor(() => expect(dataSource.getSearchTags).toHaveBeenCalledTimes(2));

    act(() => {
      capturedTimeRangeOnChange?.(makeTimeRange('2026-02-15T09:00:00Z', '2026-02-16T09:00:00Z'));
    });
    await waitFor(() => expect(dataSource.getSearchTags).toHaveBeenCalledTimes(3));

    await act(async () => {
      fastTags.resolve([{ key: 'new-tag', scope: 'span' }]);
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'new-tag' })).toBeInTheDocument();

    await act(async () => {
      slowTags.resolve([{ key: 'old-tag', scope: 'span' }]);
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: 'old-tag' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'new-tag' })).toBeInTheDocument();
  });

  it('requests tag values for active filter key', async () => {
    const dataSource = createDataSource();
    render(<ConversationsPage dataSource={dataSource} />);

    fireEvent.change(screen.getByLabelText('conversation filters'), { target: { value: 'model = ' } });

    await waitFor(() => expect(dataSource.getSearchTagValues).toHaveBeenCalled());
    const [tag] = dataSource.getSearchTagValues.mock.calls[0];
    expect(tag).toBe('model');
  });

  it('does not refetch identical tag values while in-flight or after cache fill', async () => {
    const valuesDeferred = createDeferred<string[]>();
    const dataSource = createDataSource({
      getSearchTagValues: jest.fn((_tag: string, _from: string, _to: string) => valuesDeferred.promise),
    });

    render(<ConversationsPage dataSource={dataSource} />);
    fireEvent.change(screen.getByLabelText('conversation filters'), { target: { value: 'model = ' } });

    await waitFor(() => expect(dataSource.getSearchTagValues).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('apply filters'));
    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(1));
    expect(dataSource.getSearchTagValues).toHaveBeenCalledTimes(1);

    await act(async () => {
      valuesDeferred.resolve(['gpt-4o']);
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'gpt-4o' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('apply filters'));
    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(2));
    expect(dataSource.getSearchTagValues).toHaveBeenCalledTimes(1);
  });

  it('keeps latest conversation detail when older request resolves last', async () => {
    const conv1Deferred = createDeferred<ConversationDetail>();
    const conv2Deferred = createDeferred<ConversationDetail>();

    const detailConv1: ConversationDetail = {
      conversation_id: 'conv-1',
      generation_count: 1,
      first_generation_at: '2026-02-15T09:00:00Z',
      last_generation_at: '2026-02-15T09:00:00Z',
      generations: [
        { generation_id: 'gen-1', conversation_id: 'conv-1', trace_id: 'trace-1', created_at: '2026-02-15T09:00:00Z' },
      ],
      annotations: [],
    };
    const detailConv2: ConversationDetail = {
      conversation_id: 'conv-2',
      generation_count: 1,
      first_generation_at: '2026-02-15T09:05:00Z',
      last_generation_at: '2026-02-15T09:05:00Z',
      generations: [
        { generation_id: 'gen-2', conversation_id: 'conv-2', trace_id: 'trace-2', created_at: '2026-02-15T09:05:00Z' },
      ],
      annotations: [],
    };

    const dataSource = createDataSource({
      searchConversations: jest.fn(async (_request: ConversationSearchRequest) =>
        buildSearchResponse([makeConversation('conv-1'), makeConversation('conv-2')])
      ),
      getConversationDetail: jest.fn((conversationID: string) => {
        if (conversationID === 'conv-1') {
          return conv1Deferred.promise;
        }
        if (conversationID === 'conv-2') {
          return conv2Deferred.promise;
        }
        throw new Error(`unexpected conversation id ${conversationID}`);
      }),
      getGeneration: jest.fn(async (generationID: string) => ({
        generation_id: generationID,
        conversation_id: generationID === 'gen-1' ? 'conv-1' : 'conv-2',
        trace_id: generationID === 'gen-1' ? 'trace-1' : 'trace-2',
        mode: 'SYNC',
        model: { provider: 'openai', name: 'gpt-4o' },
        input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'test' }] }],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: `reply from ${generationID}` }] }],
      })),
    });

    render(<ConversationsPage dataSource={dataSource} />);
    fireEvent.click(screen.getByLabelText('apply filters'));

    await waitFor(() => expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-1'));
    fireEvent.click(await screen.findByLabelText('select conversation conv-2'));
    await waitFor(() => expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-2'));

    await act(async () => {
      conv2Deferred.resolve(detailConv2);
      await Promise.resolve();
    });
    await waitFor(() => expect(dataSource.getGeneration).toHaveBeenCalledWith('gen-2'));
    expect(await screen.findByText('reply from gen-2')).toBeInTheDocument();

    await act(async () => {
      conv1Deferred.resolve(detailConv1);
      await Promise.resolve();
    });

    expect(dataSource.getGeneration).toHaveBeenCalledTimes(1);
    expect(dataSource.getGeneration).toHaveBeenLastCalledWith('gen-2');
    expect(screen.queryByText('reply from gen-1')).not.toBeInTheDocument();
  });

  it('clears stale generation state when conversation detail request fails', async () => {
    const dataSource = createDataSource({
      searchConversations: jest.fn(async (_request: ConversationSearchRequest) =>
        buildSearchResponse([makeConversation('conv-1'), makeConversation('conv-2')])
      ),
      getConversationDetail: jest.fn(async (conversationID: string) => {
        if (conversationID === 'conv-1') {
          return {
            conversation_id: 'conv-1',
            generation_count: 1,
            first_generation_at: '2026-02-15T09:00:00Z',
            last_generation_at: '2026-02-15T09:00:00Z',
            generations: [
              {
                generation_id: 'gen-1',
                conversation_id: 'conv-1',
                trace_id: 'trace-1',
                created_at: '2026-02-15T09:00:00Z',
              },
            ],
            annotations: [],
          };
        }
        throw new Error('conversation detail failed');
      }),
      getGeneration: jest.fn(async (_generationID: string) => ({
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        trace_id: 'trace-1',
        mode: 'SYNC',
        model: { provider: 'openai', name: 'gpt-4o' },
        input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Hello' }] }],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'World' }] }],
      })),
    });

    render(<ConversationsPage dataSource={dataSource} />);
    fireEvent.click(screen.getByLabelText('apply filters'));

    await waitFor(() => expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-1'));
    await waitFor(() => expect(dataSource.getGeneration).toHaveBeenCalledWith('gen-1'));
    expect(await screen.findByText('World')).toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText('select conversation conv-2'));
    expect(await screen.findByText(/conversation detail failed/i)).toBeInTheDocument();
    expect(screen.queryByText('World')).not.toBeInTheDocument();
  });
});
