import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AddToCollectionModal } from '../../components/saved-conversations/AddToCollectionModal';
import type { Collection } from '../../evaluation/types';

const makeCollection = (id: string, name: string, count: number): Collection => ({
  tenant_id: 'demo', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests', 8),
  makeCollection('col-2', 'Bug reports', 5),
  makeCollection('col-3', 'Edge cases', 11),
];

const dataSource = {
  listCollectionsForSavedConversation: async (id: string) => ({
    items: id === 's1' ? [collections[0]] : [],
    next_cursor: '',
  }),
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
  createCollection: async (req: { name: string; description?: string; created_by: string }) =>
    makeCollection(`col-new-${Date.now()}`, req.name, 0),
};

const meta: Meta<typeof AddToCollectionModal> = {
  title: 'SavedConversations/AddToCollectionModal',
  component: AddToCollectionModal,
};
export default meta;
type Story = StoryObj<typeof AddToCollectionModal>;

export const SingleSelection: Story = {
  args: {
    isOpen: true,
    selectedSavedIDs: ['s1'],
    collections,
    dataSource: dataSource as never,
    onClose: () => {},
    onSaved: () => {},
    onCollectionCreated: () => {},
  },
};

export const MultipleSelections: Story = {
  args: {
    ...SingleSelection.args,
    selectedSavedIDs: ['s1', 's2', 's3'],
  },
};
