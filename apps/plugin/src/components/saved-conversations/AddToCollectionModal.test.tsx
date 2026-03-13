import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddToCollectionModal } from './AddToCollectionModal';
import type { Collection } from '../../evaluation/types';
import type { EvaluationDataSource } from '../../evaluation/api';

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

const collections: Collection[] = [makeCollection('col-1', 'Regression tests'), makeCollection('col-2', 'Bug reports')];

function buildDataSource(): Pick<EvaluationDataSource, 'addCollectionMembers' | 'createCollection'> {
  return {
    addCollectionMembers: jest.fn(async () => {}),
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

  it('renders subtitle and Save disabled by default', () => {
    const ds = buildDataSource();
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
    expect(screen.getByText('2 conversations selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onClose on Cancel', () => {
    const ds = buildDataSource();
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
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Create new collection link', () => {
    const ds = buildDataSource();
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
    expect(screen.getByText(/create new collection/i)).toBeInTheDocument();
  });
});
