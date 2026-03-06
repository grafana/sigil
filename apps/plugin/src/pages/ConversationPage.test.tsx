import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ConversationPage from './ConversationPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { TraceFetcher } from '../conversation/loader';

type MockConversationsDataSource = {
  [Key in keyof ConversationsDataSource as NonNullable<ConversationsDataSource[Key]> extends (...args: any[]) => any
    ? Key
    : never]: jest.MockedFunction<NonNullable<ConversationsDataSource[Key]>>;
};

beforeAll(() => {
  if (typeof globalThis.Request === 'undefined') {
    class RequestMock {
      method: string;

      constructor(_input: unknown, init?: { method?: string }) {
        this.method = String(init?.method ?? 'GET').toUpperCase();
      }
    }
    Object.defineProperty(globalThis, 'Request', {
      writable: true,
      configurable: true,
      value: RequestMock,
    });
  }
});

const noopTraceFetcher: TraceFetcher = async () => null;

function createDataSource(conversationID = 'conv-b'): MockConversationsDataSource {
  return {
    listConversations: jest.fn(async () => ({ items: [] })),
    searchConversations: jest.fn(async (_request: import('../conversation/types').ConversationSearchRequest) => ({
      conversations: [],
      next_cursor: '',
      has_more: false,
    })),
    getConversationDetail: jest.fn(async (_id: string) => ({
      conversation_id: _id,
      user_id: 'user-42',
      generation_count: 2,
      first_generation_at: '2026-02-01T10:00:00Z',
      last_generation_at: '2026-02-01T10:01:00Z',
      generations: [
        {
          generation_id: `${conversationID}-gen-1`,
          conversation_id: _id,
          created_at: '2026-02-01T10:00:00Z',
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          usage: { total_tokens: 120 },
        },
      ],
      annotations: [],
    })),
    getGeneration: jest.fn(async (_generationID: string) => {
      throw new Error('not used');
    }),
    getSearchTags: jest.fn(async (_from: string, _to: string) => []),
    getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string) => []),
  };
}

function renderPage(dataSource: ConversationsDataSource, initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/conversations/:conversationID/view',
        element: <ConversationPage dataSource={dataSource} traceFetcher={noopTraceFetcher} />,
      },
    ],
    { initialEntries: [initialEntry] }
  );

  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

describe('ConversationPage', () => {
  it('shows conversation data when loaded from URL param', async () => {
    const dataSource = createDataSource('conv-b');
    renderPage(dataSource, '/conversations/conv-b/view');

    expect(await screen.findByText('Conversation ID')).toBeInTheDocument();
    expect(screen.getByText('Conversation ID').parentElement).toHaveTextContent('conv-b');
    expect(screen.getByText('user-42')).toBeInTheDocument();
    expect(await screen.findByText(/^Generations \(\d+\)$/)).toBeInTheDocument();
    expect(screen.queryByLabelText('select conversation conv-b')).not.toBeInTheDocument();
    expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-b');
  });

  it('prefers stored conversation title over the URL fallback', async () => {
    const dataSource = createDataSource('conv-b');
    dataSource.getConversationDetail.mockResolvedValue({
      conversation_id: 'conv-b',
      conversation_title: 'Incident: stored title',
      user_id: 'user-42',
      generation_count: 2,
      first_generation_at: '2026-02-01T10:00:00Z',
      last_generation_at: '2026-02-01T10:01:00Z',
      generations: [],
      annotations: [],
    });

    renderPage(dataSource, '/conversations/conv-b/view?conversationTitle=URL+title');

    expect(await screen.findByText('Conversation')).toBeInTheDocument();
    expect(screen.getByText('Conversation').parentElement).toHaveTextContent('Incident: stored title');
    expect(screen.getByText('conv-b')).toBeInTheDocument();
  });

  it('loads conversation for deep links outside the list', async () => {
    const dataSource = createDataSource('does-not-exist');
    const { router } = renderPage(dataSource, '/conversations/does-not-exist/view');

    await waitFor(() => expect(dataSource.getConversationDetail).toHaveBeenCalledWith('does-not-exist'));
    expect((await screen.findByText('Conversation ID')).parentElement).toHaveTextContent('does-not-exist');
    expect(router.state.location.pathname).toBe('/conversations/does-not-exist/view');
  });

  it('shows an error alert when the conversation fails to load', async () => {
    const dataSource = createDataSource();
    dataSource.getConversationDetail.mockRejectedValue(new Error('network error'));
    renderPage(dataSource, '/conversations/conv-fail/view');

    expect(await screen.findByText('Failed to load conversation')).toBeInTheDocument();
    expect(screen.getByText('network error')).toBeInTheDocument();
  });
});
