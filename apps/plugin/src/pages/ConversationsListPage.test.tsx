import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useParams } from 'react-router-dom';
import ConversationsListPage from './ConversationsListPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationListResponse, ConversationSearchRequest, SearchTag } from '../conversation/types';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class RequestMock {
    method: string;
    constructor(_input: unknown, init?: { method?: string }) {
      this.method = init?.method ?? 'GET';
    }
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(globalThis, 'Request', {
    writable: true,
    configurable: true,
    value: RequestMock,
  });
});

type MockConversationsDataSource = {
  listConversations: jest.MockedFunction<NonNullable<ConversationsDataSource['listConversations']>>;
  searchConversations: jest.MockedFunction<ConversationsDataSource['searchConversations']>;
  getConversationDetail: jest.MockedFunction<ConversationsDataSource['getConversationDetail']>;
  getGeneration: jest.MockedFunction<ConversationsDataSource['getGeneration']>;
  getSearchTags: jest.MockedFunction<ConversationsDataSource['getSearchTags']>;
  getSearchTagValues: jest.MockedFunction<ConversationsDataSource['getSearchTagValues']>;
};

function createConversationListResponse(items: ConversationListResponse['items']): ConversationListResponse {
  return { items };
}

function createDataSource(items: ConversationListResponse['items']): MockConversationsDataSource {
  const conversations = items.map((item) => ({
    conversation_id: item.id,
    generation_count: item.generation_count,
    first_generation_at: item.created_at,
    last_generation_at: item.last_generation_at,
    models: [],
    agents: [],
    error_count: 0,
    has_errors: false,
    trace_ids: [],
    rating_summary: item.rating_summary,
    annotation_count: 0,
  }));

  return {
    listConversations: jest.fn(async () => createConversationListResponse(items)),
    searchConversations: jest.fn(async (_request: ConversationSearchRequest) => ({
      conversations,
      next_cursor: '',
      has_more: false,
    })),
    getConversationDetail: jest.fn(async (_conversationID: string) => {
      throw new Error('getConversationDetail not used in ConversationsListPage');
    }),
    getGeneration: jest.fn(async (_generationID: string) => {
      throw new Error('getGeneration not used in ConversationsListPage');
    }),
    getSearchTags: jest.fn(async (_from: string, _to: string): Promise<SearchTag[]> => []),
    getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string): Promise<string[]> => []),
  };
}

function renderPage(dataSource: ConversationsDataSource, initialEntry = '/conversations') {
  function ConversationDetailRouteProbe() {
    const { conversationID } = useParams<{ conversationID: string }>();
    return <div>{`detail:${conversationID ?? ''}`}</div>;
  }

  const router = createMemoryRouter(
    [
      {
        path: '/conversations',
        element: <ConversationsListPage dataSource={dataSource} />,
      },
      {
        path: '/conversations/:conversationID/detail',
        element: <ConversationDetailRouteProbe />,
      },
    ],
    { initialEntries: [initialEntry] }
  );

  return {
    ...render(<RouterProvider router={router} />),
    router,
  };
}

describe('ConversationsListPage', () => {
  it('calculates Bad-Rated % from rated conversations only', async () => {
    const currentWindowConversations = [
      {
        conversation_id: 'current-a',
        generation_count: 3,
        first_generation_at: '2026-02-08T10:00:00Z',
        last_generation_at: '2026-02-08T10:00:00Z',
        models: [],
        agents: [],
        error_count: 0,
        has_errors: false,
        trace_ids: [],
        annotation_count: 0,
        rating_summary: { total_count: 1, has_bad_rating: true },
      },
      {
        conversation_id: 'current-b',
        generation_count: 2,
        first_generation_at: '2026-02-08T11:00:00Z',
        last_generation_at: '2026-02-08T11:00:00Z',
        models: [],
        agents: [],
        error_count: 0,
        has_errors: false,
        trace_ids: [],
        annotation_count: 0,
        rating_summary: { total_count: 1, has_bad_rating: false },
      },
      {
        conversation_id: 'current-c',
        generation_count: 1,
        first_generation_at: '2026-02-08T12:00:00Z',
        last_generation_at: '2026-02-08T12:00:00Z',
        models: [],
        agents: [],
        error_count: 0,
        has_errors: false,
        trace_ids: [],
        annotation_count: 0,
        rating_summary: { total_count: 0, has_bad_rating: false },
      },
      {
        conversation_id: 'current-d',
        generation_count: 4,
        first_generation_at: '2026-02-08T13:00:00Z',
        last_generation_at: '2026-02-08T13:00:00Z',
        models: [],
        agents: [],
        error_count: 0,
        has_errors: false,
        trace_ids: [],
        annotation_count: 0,
        rating_summary: undefined,
      },
    ];

    const searchConversations = jest
      .fn()
      .mockResolvedValueOnce({
        conversations: currentWindowConversations,
        next_cursor: '',
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: currentWindowConversations,
        next_cursor: '',
        has_more: false,
      });

    const dataSource: MockConversationsDataSource = {
      listConversations: jest.fn(async () => createConversationListResponse([])),
      searchConversations,
      getConversationDetail: jest.fn(async (_conversationID: string) => {
        throw new Error('getConversationDetail not used in ConversationsListPage');
      }),
      getGeneration: jest.fn(async (_generationID: string) => {
        throw new Error('getGeneration not used in ConversationsListPage');
      }),
      getSearchTags: jest.fn(async (_from: string, _to: string): Promise<SearchTag[]> => []),
      getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string): Promise<string[]> => []),
    };

    renderPage(dataSource);

    await waitFor(() => expect(searchConversations).toHaveBeenCalledTimes(2));

    const ratedLabel = await screen.findByText('Rated Conversations');
    const ratedTile = ratedLabel.parentElement;
    expect(ratedTile).toHaveTextContent('2');

    const badRatedLabel = await screen.findByText('Bad-Rated %');
    const badRatedTile = badRatedLabel.parentElement;
    expect(badRatedTile).toHaveTextContent('50.0%');
  });

  it('stores selected bucket in the bucket URL param', async () => {
    const dataSource = createDataSource([
      {
        id: 'conv-2',
        title: 'conv-2',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:00:00Z',
        generation_count: 2,
      },
      {
        id: 'conv-5',
        title: 'conv-5',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:00:00Z',
        generation_count: 5,
      },
    ]);

    const { router } = renderPage(dataSource);

    const bucketButton = await screen.findByRole('button', { name: 'Filter conversations with 2 LLM calls' });
    fireEvent.click(bucketButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Filter conversations with 2 LLM calls' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
    const selectedBucketSearchParams = new URLSearchParams(router.state.location.search);
    expect(selectedBucketSearchParams.get('bucket')).toBe('2-2');
    expect(await screen.findByLabelText('select conversation conv-2')).toBeInTheDocument();
    expect(screen.queryByLabelText('select conversation conv-5')).not.toBeInTheDocument();
  });

  it('persists chart view in view URL param and clears bucket when view changes', async () => {
    const dataSource = createDataSource([
      {
        id: 'conv-2',
        title: 'conv-2',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:00:00Z',
        generation_count: 2,
      },
      {
        id: 'conv-5',
        title: 'conv-5',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:00:00Z',
        generation_count: 5,
      },
    ]);

    const { router } = renderPage(dataSource);

    fireEvent.click(await screen.findByRole('button', { name: 'Filter conversations with 2 LLM calls' }));
    await waitFor(() => {
      const selectedBucketSearchParams = new URLSearchParams(router.state.location.search);
      expect(selectedBucketSearchParams.get('bucket')).toBe('2-2');
    });

    fireEvent.change(screen.getByLabelText('Conversation chart view'), { target: { value: 'time' } });

    await waitFor(() => {
      const selectedViewSearchParams = new URLSearchParams(router.state.location.search);
      expect(selectedViewSearchParams.get('view')).toBe('time');
      expect(selectedViewSearchParams.get('bucket')).toBeNull();
    });
    expect(screen.queryByLabelText('select conversation conv-2')).not.toBeInTheDocument();
  });

  it('navigates to conversation detail route from selected item', async () => {
    const dataSource = createDataSource([
      {
        id: 'devex-go-openai-2-1772463459223',
        title: 'conversation',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:00:00Z',
        generation_count: 2,
      },
    ]);

    const { router } = renderPage(dataSource);
    fireEvent.click(await screen.findByRole('button', { name: 'Filter conversations with 2 LLM calls' }));
    fireEvent.click(await screen.findByLabelText('select conversation devex-go-openai-2-1772463459223'));

    expect(await screen.findByText('detail:devex-go-openai-2-1772463459223')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/conversations/devex-go-openai-2-1772463459223/detail');
  });

  it('queries the previous time window and shows trend percentages', async () => {
    const searchConversations = jest
      .fn()
      .mockResolvedValueOnce({
        conversations: [
          {
            conversation_id: 'current-a',
            generation_count: 3,
            first_generation_at: '2026-02-08T10:00:00Z',
            last_generation_at: '2026-02-08T10:00:00Z',
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            annotation_count: 0,
            rating_summary: { total_count: 1, has_bad_rating: false },
          },
          {
            conversation_id: 'current-b',
            generation_count: 2,
            first_generation_at: '2026-02-08T11:00:00Z',
            last_generation_at: '2026-02-08T11:00:00Z',
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            annotation_count: 0,
            rating_summary: { total_count: 0, has_bad_rating: false },
          },
        ],
        next_cursor: '',
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: [
          {
            conversation_id: 'previous-a',
            generation_count: 2,
            first_generation_at: '2026-02-01T10:00:00Z',
            last_generation_at: '2026-02-01T10:00:00Z',
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            annotation_count: 0,
            rating_summary: { total_count: 1, has_bad_rating: false },
          },
        ],
        next_cursor: '',
        has_more: false,
      });

    const dataSource: MockConversationsDataSource = {
      listConversations: jest.fn(async () => createConversationListResponse([])),
      searchConversations,
      getConversationDetail: jest.fn(async (_conversationID: string) => {
        throw new Error('getConversationDetail not used in ConversationsListPage');
      }),
      getGeneration: jest.fn(async (_generationID: string) => {
        throw new Error('getGeneration not used in ConversationsListPage');
      }),
      getSearchTags: jest.fn(async (_from: string, _to: string): Promise<SearchTag[]> => []),
      getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string): Promise<string[]> => []),
    };

    renderPage(dataSource);

    await waitFor(() => expect(searchConversations).toHaveBeenCalledTimes(2));

    const firstCallArgs = searchConversations.mock.calls[0][0];
    const secondCallArgs = searchConversations.mock.calls[1][0];
    const firstFromMs = Date.parse(firstCallArgs.time_range.from);
    const firstToMs = Date.parse(firstCallArgs.time_range.to);
    const secondFromMs = Date.parse(secondCallArgs.time_range.from);
    const secondToMs = Date.parse(secondCallArgs.time_range.to);
    const windowMs = firstToMs - firstFromMs;
    expect(secondFromMs).toBe(firstFromMs - windowMs);
    expect(secondToMs).toBe(firstToMs - windowMs);

    expect(await screen.findByText('↗ 100.0%')).toBeInTheDocument();
  });

  it('uses replace when syncing from/to params to avoid back-button loop', async () => {
    const dataSource = createDataSource([]);
    const router = createMemoryRouter(
      [
        { path: '/back-target', element: <div>back-target</div> },
        { path: '/conversations', element: <ConversationsListPage dataSource={dataSource} /> },
      ],
      {
        initialEntries: ['/back-target', '/conversations'],
        initialIndex: 1,
      }
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('from')).not.toBeNull();
      expect(params.get('to')).not.toBeNull();
    });

    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/back-target'));
  });
});
