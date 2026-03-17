import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SavedConversationsPage from './SavedConversationsPage';
import type { EvaluationDataSource } from '../evaluation/api';
import type {
  Collection,
  SavedConversation,
  CollectionListResponse,
  SavedConversationListResponse,
  CollectionMembersResponse,
} from '../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'test',
  saved_id: id,
  conversation_id: `conv-${id}`,
  name,
  source: 'telemetry',
  tags: {},
  saved_by: 'alice',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
  generation_count: 0,
  total_tokens: 0,
  agent_names: [],
});

const makeCollection = (id: string, name: string): Collection => ({
  tenant_id: 'test',
  collection_id: id,
  name,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  member_count: 2,
});

function buildDataSource(overrides?: Partial<EvaluationDataSource>): EvaluationDataSource {
  const base: Partial<EvaluationDataSource> = {
    listCollections: jest.fn(
      async (): Promise<CollectionListResponse> => ({
        items: [makeCollection('col-1', 'Regression tests')],
        next_cursor: '',
      })
    ),
    listSavedConversations: jest.fn(
      async (): Promise<SavedConversationListResponse> => ({
        items: [makeSC('s1', 'Auth flow edge case'), makeSC('s2', 'Rate limiting test')],
        next_cursor: '',
      })
    ),
    listCollectionMembers: jest.fn(
      async (): Promise<CollectionMembersResponse> => ({
        items: [makeSC('s1', 'Auth flow edge case')],
        next_cursor: '',
      })
    ),
    listCollectionsForSavedConversation: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createCollection: jest.fn(async (req) => makeCollection('col-new', req.name)),
    updateCollection: jest.fn(async (_, req) => makeCollection('col-1', req.name ?? 'Updated')),
    deleteCollection: jest.fn(async () => {}),
    deleteSavedConversation: jest.fn(async () => {}),
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
      expect(ds.listCollectionMembers).toHaveBeenCalledWith('col-1', 25, undefined);
    });
  });

  it('shows error alert when listSavedConversations fails', async () => {
    const ds = buildDataSource({
      listSavedConversations: jest.fn(async () => {
        throw new Error('network error');
      }),
    });
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('All saved count stays fixed when switching to a collection', async () => {
    const ds = buildDataSource({
      listSavedConversations: jest.fn(
        async (): Promise<SavedConversationListResponse> => ({
          items: [makeSC('s1', 'Auth flow edge case'), makeSC('s2', 'Rate limiting test')],
          next_cursor: '',
          total_count: 2,
        })
      ),
    });
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    // "All saved" initially shows total from listSavedConversations (2 items)
    await waitFor(() => screen.getByText('Regression tests'));
    // Switch to the collection (listCollectionMembers returns 1 item)
    fireEvent.click(screen.getByText('Regression tests'));
    await waitFor(() => expect(ds.listCollectionMembers).toHaveBeenCalled());
    // All saved count should still be 2, not 1
    const allSavedCount = screen.getAllByText('2');
    expect(allSavedCount.length).toBeGreaterThan(0);
  });

  it('decrements allSavedCount and collection member_count after unsave from collection view', async () => {
    const ds = buildDataSource({
      listSavedConversations: jest.fn(
        async (): Promise<SavedConversationListResponse> => ({
          items: [makeSC('s1', 'Auth flow edge case'), makeSC('s2', 'Rate limiting test')],
          next_cursor: '',
          total_count: 2,
        })
      ),
    });
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Regression tests'));
    // Initial "All saved" count is 2
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    // Switch to a collection
    fireEvent.click(screen.getByText('Regression tests'));
    await waitFor(() => screen.getByText('Auth flow edge case'));
    // Select and unsave from collection view
    fireEvent.click(screen.getByLabelText('Select Auth flow edge case'));
    await waitFor(() => screen.getByText(/^unsave$/i));
    fireEvent.click(screen.getByText(/^unsave$/i));
    // Confirm the unsave dialog
    await waitFor(() => screen.getAllByText(/^unsave$/i).length > 1);
    fireEvent.click(screen.getAllByText(/^unsave$/i)[1]);
    await waitFor(() => expect(ds.deleteSavedConversation).toHaveBeenCalledWith('s1'));
    // allSavedCount should have been decremented
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('calls removeCollectionMember when Remove is clicked from active collection', async () => {
    const ds = buildDataSource();
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    // Select the collection
    await waitFor(() => screen.getByText('Regression tests'));
    fireEvent.click(screen.getByText('Regression tests'));
    // Wait for collection members to load
    await waitFor(() => screen.getByText('Auth flow edge case'));
    // Select a conversation (find its checkbox by aria-label)
    const checkbox = screen.getByLabelText('Select Auth flow edge case');
    fireEvent.click(checkbox);
    // Click Remove from collection
    await waitFor(() => screen.getByText(/remove from collection/i));
    fireEvent.click(screen.getByText(/remove from collection/i));
    await waitFor(() => {
      expect(ds.removeCollectionMember).toHaveBeenCalledWith('col-1', 's1');
    });
  });
});
