import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ConversationsBrowserPage from './ConversationsBrowserPage';
import ConversationPage from './ConversationPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { TraceFetcher } from '../conversation/loader';

type MockConversationsDataSource = {
  [Key in keyof ConversationsDataSource as NonNullable<ConversationsDataSource[Key]> extends (...args: any[]) => any
    ? Key
    : never]: jest.MockedFunction<NonNullable<ConversationsDataSource[Key]>>;
};

beforeAll(() => {
  global.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [{ target, contentRect: { width: 800, height: 200 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

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

function createDataSource(): MockConversationsDataSource {
  const currentConversations = [
    {
      conversation_id: 'conv-b',
      generation_count: 3,
      first_generation_at: '2026-02-01T10:00:00Z',
      last_generation_at: '2026-02-01T10:00:00Z',
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      annotation_count: 0,
    },
    {
      conversation_id: 'conv-a',
      generation_count: 1,
      first_generation_at: '2026-02-02T10:00:00Z',
      last_generation_at: '2026-02-02T10:00:00Z',
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      annotation_count: 0,
    },
  ];
  return {
    listConversations: jest.fn(async () => ({ items: [] })),
    searchConversations: jest
      .fn()
      .mockResolvedValueOnce({
        conversations: currentConversations,
        next_cursor: '',
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: [],
        next_cursor: '',
        has_more: false,
      }),
    getConversationDetail: jest.fn(async (_conversationID: string) => {
      return {
        conversation_id: _conversationID,
        generation_count: 2,
        first_generation_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:01:00Z',
        generations: [
          {
            generation_id: `${_conversationID}-gen-1`,
            conversation_id: _conversationID,
            created_at: '2026-02-01T10:00:00Z',
            model: { provider: 'openai', name: 'gpt-4o-mini' },
            usage: { total_tokens: 120 },
          },
          {
            generation_id: `${_conversationID}-gen-2`,
            conversation_id: _conversationID,
            created_at: '2026-02-01T10:01:00Z',
            model: { provider: 'openai', name: 'gpt-4o-mini' },
            usage: { total_tokens: 180 },
          },
        ],
        annotations: [],
      };
    }),
    getGeneration: jest.fn(async (_generationID: string) => {
      throw new Error('getGeneration not used in ConversationsBrowserPage');
    }),
    getSearchTags: jest.fn(async (_from: string, _to: string) => []),
    getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string) => []),
  };
}

describe('ConversationsBrowserPage', () => {
  function renderPage(dataSource: ConversationsDataSource, initialEntry = '/conversations') {
    const router = createMemoryRouter(
      [
        {
          path: '/conversations/:conversationID/view',
          element: <ConversationPage dataSource={dataSource} traceFetcher={noopTraceFetcher} />,
        },
        {
          path: '/conversations',
          element: <ConversationsBrowserPage dataSource={dataSource} />,
        },
      ],
      { initialEntries: [initialEntry] }
    );

    return {
      router,
      ...render(<RouterProvider router={router} />),
    };
  }

  it('shows expanded list when no selection, then shows summary after selecting', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(dataSource);

    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(2));
    expect(dataSource.searchConversations.mock.calls[0][0].select).toContain('span.sigil.sdk.name');
    expect(dataSource.searchConversations.mock.calls[0][0].select).toHaveLength(1);

    expect(await screen.findByLabelText('select conversation conv-a')).toBeInTheDocument();
    expect(screen.queryByText('Conversation ID')).not.toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.queryByText(/^Generations \(\d+\)$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('select conversation conv-b'));
    expect(await screen.findByText('Conversation ID')).toBeInTheDocument();
    expect(await screen.findByText(/^Generations \(\d+\)$/)).toBeInTheDocument();
    expect(screen.getByText('Conversation ID').parentElement).toHaveTextContent('conv-b');
    expect(router.state.location.pathname).toBe('/conversations/conv-b/view');
    expect(screen.queryByLabelText('select conversation conv-b')).not.toBeInTheDocument();
    expect(dataSource.getConversationDetail).toHaveBeenCalledWith('conv-b');
  });
});
