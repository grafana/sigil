import React, { useState } from 'react';
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

export default {
  title: 'SavedConversations/SavedConversationsList',
  component: SavedConversationsList,
};

export const Default = () => {
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
        onAddToCollection={() => {}}
        onRemoveFromCollection={() => {}}
        onUnsave={() => {}}
        hasNextPage={false}
        hasPrevPage={false}
        onPageChange={() => {}}
        pageSize={25}
        onPageSizeChange={() => {}}
        searchQuery={query}
        onSearchChange={setQuery}
      />
    </div>
  );
};

export const WithActiveCollection = () => {
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
        onUnsave={(ids) => console.log('unsave', [...ids])}
        hasNextPage
        hasPrevPage={false}
        onPageChange={() => {}}
        pageSize={25}
        onPageSizeChange={() => {}}
        searchQuery=""
        onSearchChange={() => {}}
      />
    </div>
  );
};

export const Loading = () => (
  <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
    <SavedConversationsList
      conversations={[]}
      isLoading
      selectedIDs={new Set()}
      onSelectionChange={() => {}}
      activeCollectionID={null}
      onAddToCollection={() => {}}
      onRemoveFromCollection={() => {}}
      onUnsave={() => {}}
      hasNextPage={false}
      hasPrevPage={false}
      onPageChange={() => {}}
      pageSize={25}
      onPageSizeChange={() => {}}
      searchQuery=""
      onSearchChange={() => {}}
    />
  </div>
);

export const Empty = () => (
  <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
    <SavedConversationsList
      conversations={[]}
      isLoading={false}
      selectedIDs={new Set()}
      onSelectionChange={() => {}}
      activeCollectionID={null}
      onAddToCollection={() => {}}
      onRemoveFromCollection={() => {}}
      onUnsave={() => {}}
      hasNextPage={false}
      hasPrevPage={false}
      onPageChange={() => {}}
      pageSize={25}
      onPageSizeChange={() => {}}
      searchQuery=""
      onSearchChange={() => {}}
    />
  </div>
);
