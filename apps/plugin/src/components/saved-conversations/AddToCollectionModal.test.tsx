import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('keeps create form open with input when create fails', async () => {
    const ds = buildDataSource();
    const createCollection = jest.fn(async () => {
      throw new Error('create failed');
    });

    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={{ ...ds, createCollection } as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /create new collection/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Important collection' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(createCollection).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('create failed'));
    expect(screen.getByDisplayValue('Important collection')).toBeInTheDocument();
    expect(screen.getByText('New collection')).toBeInTheDocument();
  });
});
