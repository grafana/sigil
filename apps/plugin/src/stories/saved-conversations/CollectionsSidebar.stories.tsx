import React, { useState } from 'react';
import { CollectionsSidebar } from '../../components/saved-conversations/CollectionsSidebar';
import type { Collection } from '../../evaluation/types';

const makeCollection = (id: string, name: string, count: number): Collection => ({
  tenant_id: 'demo',
  collection_id: id,
  name,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests', 8),
  makeCollection('col-2', 'Bug reports', 5),
  makeCollection('col-3', 'Edge cases', 11),
];

export default {
  title: 'SavedConversations/CollectionsSidebar',
  component: CollectionsSidebar,
};

export const Default = () => {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div style={{ height: 400, display: 'flex' }}>
      <CollectionsSidebar
        collections={collections}
        totalCount={24}
        activeCollectionID={active}
        onSelect={setActive}
        onCreateCollection={() => alert('create')}
        onRenameCollection={async (id, name) => console.log('rename', id, name)}
        onDeleteCollection={async (id) => console.log('delete', id)}
      />
    </div>
  );
};

export const Empty = () => (
  <div style={{ height: 400, display: 'flex' }}>
    <CollectionsSidebar
      collections={[]}
      totalCount={0}
      activeCollectionID={null}
      onSelect={() => {}}
      onCreateCollection={() => {}}
      onRenameCollection={async () => {}}
      onDeleteCollection={async () => {}}
    />
  </div>
);
