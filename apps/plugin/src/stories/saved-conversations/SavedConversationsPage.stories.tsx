import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { MemoryRouter } from 'react-router-dom';
import SavedConversationsPage from '../../pages/SavedConversationsPage';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { Collection, SavedConversation } from '../../evaluation/types';

const makeSC = (id: string, name: string, by = 'alice'): SavedConversation => ({
  tenant_id: 'demo', saved_id: id, conversation_id: `conv-${id}`,
  name, source: 'telemetry', tags: {}, saved_by: by,
  created_at: '2026-03-10T00:00:00Z', updated_at: '2026-03-10T00:00:00Z',
});

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

const conversations: SavedConversation[] = [
  makeSC('s1', 'Auth flow edge case'),
  makeSC('s2', 'Rate limiting test', 'bob'),
  makeSC('s3', 'Multi-turn hallucination'),
  makeSC('s4', 'Tool use timeout', 'carol'),
  makeSC('s5', 'Streaming token drop', 'bob'),
];

const dataSource: Partial<EvaluationDataSource> = {
  listCollections: async () => ({ items: collections, next_cursor: '' }),
  listSavedConversations: async () => ({ items: conversations, next_cursor: '' }),
  listCollectionMembers: async (id) => ({
    items: id === 'col-1' ? conversations.slice(0, 2) : conversations.slice(0, 1),
    next_cursor: '',
  }),
  listCollectionsForSavedConversation: async () => ({ items: [], next_cursor: '' }),
  createCollection: async (req) => makeCollection(`col-${Date.now()}`, req.name, 0),
  updateCollection: async (id, req) => ({ ...collections[0], collection_id: id, name: req.name ?? '' }),
  deleteCollection: async () => {},
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
};

const meta: Meta<typeof SavedConversationsPage> = {
  title: 'SavedConversations/SavedConversationsPage',
  component: SavedConversationsPage,
  decorators: [(Story: React.ComponentType) => <MemoryRouter><Story /></MemoryRouter>],
};
export default meta;
type Story = StoryObj<typeof SavedConversationsPage>;

export const Default: Story = {
  args: { dataSource: dataSource as EvaluationDataSource },
};

export const Empty: Story = {
  args: {
    dataSource: {
      ...dataSource,
      listCollections: async () => ({ items: [], next_cursor: '' }),
      listSavedConversations: async () => ({ items: [], next_cursor: '' }),
    } as EvaluationDataSource,
  },
};
