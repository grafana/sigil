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

  it('calls onDeleteCollection when deleting the active collection', async () => {
    onDeleteCollection.mockResolvedValue(undefined);
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
    fireEvent.click(screen.getAllByLabelText(/collection options/i)[0]);
    fireEvent.click(screen.getByText(/^delete$/i));
    fireEvent.click(screen.getByTestId('data-testid Confirm Modal Danger Button'));
    await waitFor(() => expect(onDeleteCollection).toHaveBeenCalledWith('col-1'));
    // onSelect(null) is NOT called from the sidebar — the page's handleDeleteCollection
    // already resets activeCollectionID when the deleted collection was active.
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });

  it('shows filter input when there are more than 5 collections and filters by name', () => {
    const manyCollections = [
      makeCollection('c1', 'Alpha'),
      makeCollection('c2', 'Beta'),
      makeCollection('c3', 'Gamma'),
      makeCollection('c4', 'Delta'),
      makeCollection('c5', 'Epsilon'),
      makeCollection('c6', 'Zeta'),
    ];
    render(
      <CollectionsSidebar
        collections={manyCollections}
        totalCount={0}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    const filterInput = screen.getByPlaceholderText(/filter collections/i);
    expect(filterInput).toBeInTheDocument();
    fireEvent.change(filterInput, { target: { value: 'et' } });
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Zeta')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
  });

  it('does not show filter input when there are 5 or fewer collections', () => {
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
    expect(screen.queryByPlaceholderText(/filter collections/i)).not.toBeInTheDocument();
  });

  it('reverts input and shows alert when rename fails', async () => {
    onRenameCollection.mockRejectedValue(new Error('Server error'));
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
    fireEvent.change(input, { target: { value: 'Bad name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onRenameCollection).toHaveBeenCalledWith('col-1', 'Bad name'));
    await waitFor(() => expect(screen.getByDisplayValue('Regression tests')).toBeInTheDocument());
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });
});
