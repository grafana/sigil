import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SavedConversationsList } from '../../components/saved-conversations/SavedConversationsList';
import type { SavedConversation } from '../../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'demo',
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

const conversations = [
  makeSC('s1', 'Auth flow edge case'),
  makeSC('s2', 'Rate limiting test'),
  makeSC('s3', 'Multi-turn hallucination'),
];

const meta: Meta<typeof SavedConversationsList> = {
  title: 'SavedConversations/SavedConversationsList',
  component: SavedConversationsList,
};
export default meta;
type Story = StoryObj<typeof SavedConversationsList>;

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState(new Set<string>());
    const [query, setQuery] = useState('');
    return (
      <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
        <SavedConversationsList
          conversations={conversations}
          isLoading={false}
          selectedIDs={selected}
          onSelectionChange={setSelected}
          activeCollectionID={null}
          onAddToCollection={() => console.log('add to collection')}
          onRemoveFromCollection={() => {}}
          hasNextPage={false}
          hasPrevPage={false}
          onPageChange={() => {}}
          searchQuery={query}
          onSearchChange={setQuery}
        />
      </div>
    );
  },
};

export const WithActiveCollection: Story = {
  render: () => {
    const [selected, setSelected] = useState(new Set<string>(['s1']));
    return (
      <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
        <SavedConversationsList
          conversations={conversations}
          isLoading={false}
          selectedIDs={selected}
          onSelectionChange={setSelected}
          activeCollectionID="col-1"
          onAddToCollection={() => {}}
          onRemoveFromCollection={(ids) => console.log('remove', [...ids])}
          hasNextPage
          hasPrevPage={false}
          onPageChange={() => {}}
          searchQuery=""
          onSearchChange={() => {}}
        />
      </div>
    );
  },
};

export const Loading: Story = {
  args: {
    conversations: [],
    isLoading: true,
    selectedIDs: new Set(),
    onSelectionChange: () => {},
    activeCollectionID: null,
    onAddToCollection: () => {},
    onRemoveFromCollection: () => {},
    hasNextPage: false,
    hasPrevPage: false,
    onPageChange: () => {},
    searchQuery: '',
    onSearchChange: () => {},
  },
};

export const Empty: Story = {
  args: {
    ...Loading.args,
    isLoading: false,
  },
};
