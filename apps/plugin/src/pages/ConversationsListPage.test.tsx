import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useParams } from 'react-router-dom';
import ConversationsListPage from './ConversationsListPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationListResponse } from '../conversation/types';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class RequestMock {
    constructor(_input: unknown, _init?: unknown) {}
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
  [Key in keyof ConversationsDataSource]: jest.MockedFunction<ConversationsDataSource[Key]>;
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
    searchConversations: jest.fn(async () => ({
      conversations,
      next_cursor: '',
      has_more: false,
    })),
    getConversationDetail: jest.fn(async () => {
      throw new Error('getConversationDetail not used in ConversationsListPage');
    }),
    getGeneration: jest.fn(async () => {
      throw new Error('getGeneration not used in ConversationsListPage');
    }),
    getSearchTags: jest.fn(async () => []),
    getSearchTagValues: jest.fn(async () => []),
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

  return render(
    <RouterProvider router={router} />
  );
}

describe('ConversationsListPage', () => {
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

    renderPage(dataSource);

    const bucketButton = await screen.findByRole('button', { name: 'Filter conversations with 2 LLM calls' });
    fireEvent.click(bucketButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Filter conversations with 2 LLM calls' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
    expect(window.location.search).toBe('?bucket=2-2');
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

    renderPage(dataSource);

    fireEvent.click(await screen.findByRole('button', { name: 'Filter conversations with 2 LLM calls' }));
    await waitFor(() => expect(window.location.search).toBe('?bucket=2-2'));

    fireEvent.change(screen.getByLabelText('Conversation chart view'), { target: { value: 'time' } });

    await waitFor(() => expect(window.location.search).toBe('?view=time'));
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

    renderPage(dataSource);
    fireEvent.click(await screen.findByRole('button', { name: 'Filter conversations with 2 LLM calls' }));
    fireEvent.click(await screen.findByLabelText('select conversation devex-go-openai-2-1772463459223'));

    expect(await screen.findByText('detail:devex-go-openai-2-1772463459223')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/conversations/devex-go-openai-2-1772463459223/detail');
  });
});
