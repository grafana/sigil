import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddToCollectionModal } from './AddToCollectionModal';
import type { Collection } from '../../evaluation/types';
import type { EvaluationDataSource } from '../../evaluation/api';

const makeCollection = (id: string, name: string): Collection => ({
  tenant_id: 'test', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: 2,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests'),
  makeCollection('col-2', 'Bug reports'),
];

function buildDataSource(memberMap: Record<string, string[]>): Pick<EvaluationDataSource,
  'listCollectionsForSavedConversation' | 'addCollectionMembers' | 'removeCollectionMember' | 'createCollection'
> {
  return {
    listCollectionsForSavedConversation: jest.fn(async (savedID: string) => ({
      items: collections.filter((c) => memberMap[savedID]?.includes(c.collection_id)),
      next_cursor: '',
    })),
    addCollectionMembers: jest.fn(async () => {}),
    removeCollectionMember: jest.fn(async () => {}),
    createCollection: jest.fn(async () => collections[0]),
  };
}

describe('AddToCollectionModal', () => {
  const onClose = jest.fn();
  const onSaved = jest.fn();

  beforeEach(() => {
    onClose.mockReset();
    onSaved.mockReset();
  });

  it('shows all collections as checkboxes', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Regression tests')).toBeInTheDocument();
      expect(screen.getByLabelText('Bug reports')).toBeInTheDocument();
    });
  });

  it('pre-checks collections where all selected items are members', async () => {
    // s1 is already in col-1
    const ds = buildDataSource({ s1: ['col-1'] });
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => {
      expect((screen.getByLabelText('Regression tests') as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText('Bug reports') as HTMLInputElement).checked).toBe(false);
    });
  });

  it('calls addCollectionMembers on Save for newly checked collections', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1', 's2']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => screen.getByLabelText('Regression tests'));
    fireEvent.click(screen.getByLabelText('Regression tests'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(ds.addCollectionMembers).toHaveBeenCalledWith('col-1', {
        saved_ids: ['s1', 's2'],
        added_by: 'user',
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('disables Save when no collections are checked', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => screen.getByLabelText('Regression tests'));
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('enables Save after checking a collection', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => screen.getByLabelText('Regression tests'));
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Regression tests'));
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('calls onClose on Cancel', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => screen.getByLabelText('Regression tests'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
