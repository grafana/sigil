import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import ConversationsListPage from './ConversationsListPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationListResponse } from '../conversation/types';

type MockConversationsDataSource = {
  [Key in keyof ConversationsDataSource]: jest.MockedFunction<ConversationsDataSource[Key]>;
};

function createConversationListResponse(items: ConversationListResponse['items']): ConversationListResponse {
  return { items };
}

function createDataSource(items: ConversationListResponse['items']): MockConversationsDataSource {
  return {
    listConversations: jest.fn(async () => createConversationListResponse(items)),
    searchConversations: jest.fn(async () => {
      throw new Error('searchConversations not used in ConversationsListPage');
    }),
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
  const router = createMemoryRouter(
    [
      {
        path: '/conversations',
        element: <ConversationsListPage dataSource={dataSource} />,
      },
    ],
    { initialEntries: [initialEntry] }
  );

  return render(
    <RouterProvider router={router} />
  );
}

describe('ConversationsListPage', () => {
  it('stores selected bucket in URL query params', async () => {
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
    expect(window.location.search).toBe('?selection=2-2');
    expect(await screen.findByLabelText('select conversation conv-2')).toBeInTheDocument();
    expect(screen.queryByLabelText('select conversation conv-5')).not.toBeInTheDocument();
  });

  it('clears selected bucket URL param when chart view changes', async () => {
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
    await waitFor(() => expect(window.location.search).toBe('?selection=2-2'));

    fireEvent.change(screen.getByLabelText('Conversation chart view'), { target: { value: 'time' } });

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByLabelText('select conversation conv-2')).not.toBeInTheDocument();
  });
});
