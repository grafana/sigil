import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectionsSidebar } from './CollectionsSidebar';
import type { Collection } from '../../evaluation/types';

const makeCollection = (id: string, name: string, count = 3): Collection => ({
  tenant_id: 'test',
  collection_id: id,
  name,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

describe('CollectionsSidebar', () => {
  const onSelect = jest.fn();
  const onCreateCollection = jest.fn();
  const onRenameCollection = jest.fn();
  const onDeleteCollection = jest.fn();

  const collections: Collection[] = [
    makeCollection('col-1', 'Regression tests', 8),
    makeCollection('col-2', 'Bug reports', 5),
  ];

  beforeEach(() => {
    onSelect.mockReset();
    onCreateCollection.mockReset();
    onRenameCollection.mockReset();
    onDeleteCollection.mockReset();
  });

  it('renders All saved and collection names', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={24}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    expect(screen.getByText('All saved')).toBeInTheDocument();
    expect(screen.getByText('Regression tests')).toBeInTheDocument();
    expect(screen.getByText('Bug reports')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('calls onSelect with null when All saved is clicked', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID="col-1"
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getByText('All saved'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect with collection_id when a collection is clicked', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getByText('Regression tests'));
    expect(onSelect).toHaveBeenCalledWith('col-1');
  });

  it('enters inline rename mode and calls onRenameCollection on confirm', async () => {
    onRenameCollection.mockResolvedValue(undefined);
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getAllByLabelText(/collection options/i)[0]);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByDisplayValue('Regression tests');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onRenameCollection).toHaveBeenCalledWith('col-1', 'New name'));
  });

  it('cancels inline rename on Escape', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getAllByLabelText(/collection options/i)[0]);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByDisplayValue('Regression tests');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByDisplayValue('Regression tests')).not.toBeInTheDocument();
    expect(screen.getByText('Regression tests')).toBeInTheDocument();
  });

  it('calls onCreateCollection when New collection is clicked', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getByText(/new collection/i));
    expect(onCreateCollection).toHaveBeenCalled();
  });
});
