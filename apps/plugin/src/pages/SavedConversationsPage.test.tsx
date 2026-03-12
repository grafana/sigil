import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SavedConversationsPage from './SavedConversationsPage';
import type { EvaluationDataSource } from '../evaluation/api';
import type { Collection, SavedConversation, CollectionListResponse, SavedConversationListResponse, CollectionMembersResponse } from '../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'test', saved_id: id, conversation_id: `conv-${id}`,
  name, source: 'telemetry', tags: {}, saved_by: 'alice',
  created_at: '2026-03-10T00:00:00Z', updated_at: '2026-03-10T00:00:00Z',
});

const makeCollection = (id: string, name: string): Collection => ({
  tenant_id: 'test', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: 2,
});

function buildDataSource(overrides?: Partial<EvaluationDataSource>): EvaluationDataSource {
  const base: Partial<EvaluationDataSource> = {
    listCollections: jest.fn(async (): Promise<CollectionListResponse> => ({
      items: [makeCollection('col-1', 'Regression tests')],
      next_cursor: '',
    })),
    listSavedConversations: jest.fn(async (): Promise<SavedConversationListResponse> => ({
      items: [makeSC('s1', 'Auth flow edge case'), makeSC('s2', 'Rate limiting test')],
      next_cursor: '',
    })),
    listCollectionMembers: jest.fn(async (): Promise<CollectionMembersResponse> => ({
      items: [makeSC('s1', 'Auth flow edge case')],
      next_cursor: '',
    })),
    listCollectionsForSavedConversation: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createCollection: jest.fn(async (req) => makeCollection('col-new', req.name)),
    updateCollection: jest.fn(async (_, req) => makeCollection('col-1', req.name ?? 'Updated')),
    deleteCollection: jest.fn(async () => {}),
    addCollectionMembers: jest.fn(async () => {}),
    removeCollectionMember: jest.fn(async () => {}),
  };
  return { ...base, ...overrides } as EvaluationDataSource;
}

describe('SavedConversationsPage', () => {
  it('loads and shows conversations and collections', async () => {
    const ds = buildDataSource();
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Auth flow edge case')).toBeInTheDocument();
      expect(screen.getByText('Regression tests')).toBeInTheDocument();
    });
  });

  it('filters conversations when a collection is selected', async () => {
    const ds = buildDataSource();
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Regression tests'));
    fireEvent.click(screen.getByText('Regression tests'));
    await waitFor(() => {
      expect(ds.listCollectionMembers).toHaveBeenCalledWith('col-1', undefined, undefined);
    });
  });

  it('shows error alert when listSavedConversations fails', async () => {
    const ds = buildDataSource({
      listSavedConversations: jest.fn(async () => { throw new Error('network error'); }),
    });
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
