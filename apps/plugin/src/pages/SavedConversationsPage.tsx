import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, useStyles2 } from '@grafana/ui';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { Collection, SavedConversation } from '../evaluation/types';
import { CollectionsSidebar } from '../components/saved-conversations/CollectionsSidebar';
import { SavedConversationsList } from '../components/saved-conversations/SavedConversationsList';
import { AddToCollectionModal } from '../components/saved-conversations/AddToCollectionModal';
import { CollectionFormModal } from '../components/saved-conversations/CollectionFormModal';

async function fetchAllCollections(
  dataSource: Pick<EvaluationDataSource, 'listCollections'>,
  max = 200
): Promise<Collection[]> {
  const all: Collection[] = [];
  let cursor: string | undefined;
  do {
    const resp = await dataSource.listCollections(Math.min(50, max - all.length), cursor);
    all.push(...resp.items);
    cursor = resp.next_cursor || undefined;
  } while (cursor && all.length < max);
  return all.slice(0, max);
}

export type SavedConversationsPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  }),
  header: css({
    padding: theme.spacing(2, 3, 1.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  title: css({
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),
  subtitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(0.25),
  }),
  body: css({
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  }),
  resizeHandle: css({
    width: 4,
    flexShrink: 0,
    cursor: 'col-resize',
    background: 'transparent',
    '&:hover, &:active': {
      background: theme.colors.primary.main,
    },
  }),
  errorBar: css({
    margin: theme.spacing(1, 2),
  }),
});

export default function SavedConversationsPage({
  dataSource = defaultEvaluationDataSource,
}: SavedConversationsPageProps) {
  const styles = useStyles2(getStyles);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const isDragging = useRef(false);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) {
        return;
      }
      setSidebarWidth(Math.max(140, Math.min(400, startWidth + ev.clientX - startX)));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionID, setActiveCollectionID] = useState<string | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [allSavedCount, setAllSavedCount] = useState(0);
  const [allSavedTotal, setAllSavedTotal] = useState<number | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [prevCursors, setPrevCursors] = useState<Array<string | undefined>>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pageSize, setPageSize] = useState(25);

  // Load all collections on mount (truncate at 200 per spec, following next_cursor)
  useEffect(() => {
    fetchAllCollections(dataSource)
      .then((items) => setCollections(items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load collections'));
  }, [dataSource]);

  // Load conversations whenever active collection changes
  const loadConversations = useCallback(
    async (cursor?: string) => {
      setCurrentCursor(cursor);
      setIsLoading(true);
      setError(undefined);
      try {
        if (activeCollectionID === null) {
          const resp = await dataSource.listSavedConversations(undefined, pageSize, cursor);
          setConversations(resp.items);
          setNextCursor(resp.next_cursor || undefined);
          if (resp.total_count !== undefined) {
            setAllSavedCount(resp.total_count);
          } else if (cursor === undefined) {
            // First page with no total_count — use items.length as a floor so
            // the sidebar shows at least how many conversations are on page 1.
            setAllSavedCount(resp.items.length);
          }
          setAllSavedTotal(resp.total_count);
        } else {
          const resp = await dataSource.listCollectionMembers(activeCollectionID, pageSize, cursor);
          setConversations(resp.items);
          setNextCursor(resp.next_cursor || undefined);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load conversations');
      } finally {
        setIsLoading(false);
      }
    },
    [dataSource, activeCollectionID, pageSize]
  );

  // Reset selection/search/pagination only when the active collection changes
  useEffect(() => {
    setSelectedIDs(new Set());
    setSearchQuery('');
    setNextCursor(undefined);
    setPrevCursors([]);
  }, [activeCollectionID]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleSelectCollection = (id: string | null) => {
    setActiveCollectionID(id);
  };

  const handleCreateCollection = async (values: { name: string; description?: string }) => {
    const created = await dataSource.createCollection({
      name: values.name,
      description: values.description,
      created_by: 'user',
    });
    setCollections((prev) => [...prev, created]);
    setActiveCollectionID(created.collection_id);
    setShowCreateModal(false);
  };

  const handleRenameCollection = async (id: string, name: string) => {
    const updated = await dataSource.updateCollection(id, { name, updated_by: 'user' });
    setCollections((prev) => prev.map((c) => (c.collection_id === id ? { ...c, name: updated.name } : c)));
  };

  const handleDeleteCollection = async (id: string) => {
    await dataSource.deleteCollection(id);
    setCollections((prev) => prev.filter((c) => c.collection_id !== id));
    if (activeCollectionID === id) {
      setActiveCollectionID(null);
    }
  };

  const handleUnsave = async (ids: Set<string>) => {
    setError(undefined);
    try {
      await Promise.all([...ids].map((id) => dataSource.deleteSavedConversation(id)));
      setSelectedIDs(new Set());
      setPrevCursors([]);
      setAllSavedCount((prev) => Math.max(0, prev - ids.size));
      if (activeCollectionID) {
        setCollections((prev) =>
          prev.map((c) =>
            c.collection_id === activeCollectionID ? { ...c, member_count: Math.max(0, c.member_count - ids.size) } : c
          )
        );
      }
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unsave conversations');
    }
  };

  const handleRemoveFromCollection = async (ids: Set<string>) => {
    if (!activeCollectionID) {
      return;
    }
    setError(undefined);
    try {
      await Promise.all([...ids].map((id) => dataSource.removeCollectionMember(activeCollectionID, id)));
      setSelectedIDs(new Set());
      setPrevCursors([]);
      await loadConversations();
      setCollections((prev) =>
        prev.map((c) =>
          c.collection_id === activeCollectionID ? { ...c, member_count: Math.max(0, c.member_count - ids.size) } : c
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove conversations');
    }
  };

  const handleSavedToCollection = async () => {
    setShowAddModal(false);
    setSelectedIDs(new Set());
    setPrevCursors([]);
    // Refresh collections to update member counts
    fetchAllCollections(dataSource)
      .then((items) => setCollections(items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to refresh collections'));
    await loadConversations();
  };

  const handleCollectionCreatedFromDialog = (collection: Collection) => {
    setCollections((prev) => [...prev, collection]);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentCursor(undefined);
    setNextCursor(undefined);
    setPrevCursors([]);
  };

  const handlePageChange = (direction: 'next' | 'prev') => {
    if (direction === 'next' && nextCursor) {
      setPrevCursors((prev) => [...prev, currentCursor]); // push the cursor that loaded THIS page
      loadConversations(nextCursor);
    } else if (direction === 'prev' && prevCursors.length > 0) {
      const newPrev = [...prevCursors];
      const cursor = newPrev.pop();
      setPrevCursors(newPrev);
      loadConversations(cursor);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Saved conversations</h1>
        <p className={styles.subtitle}>Browse and organize saved conversations</p>
      </div>
      {error && (
        <div className={styles.errorBar}>
          <Alert title={error} severity="error" onRemove={() => setError(undefined)} />
        </div>
      )}
      <div className={styles.body}>
        <CollectionsSidebar
          collections={collections}
          totalCount={allSavedCount}
          activeCollectionID={activeCollectionID}
          onSelect={handleSelectCollection}
          onCreateCollection={() => setShowCreateModal(true)}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
          width={sidebarWidth}
        />
        <div className={styles.resizeHandle} onMouseDown={onResizeMouseDown} />
        <SavedConversationsList
          conversations={conversations}
          isLoading={isLoading}
          selectedIDs={selectedIDs}
          onSelectionChange={setSelectedIDs}
          activeCollectionID={activeCollectionID}
          onAddToCollection={() => setShowAddModal(true)}
          onRemoveFromCollection={handleRemoveFromCollection}
          onUnsave={handleUnsave}
          hasNextPage={!!nextCursor}
          hasPrevPage={prevCursors.length > 0}
          onPageChange={handlePageChange}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          totalCount={
            activeCollectionID === null
              ? allSavedTotal
              : collections.find((c) => c.collection_id === activeCollectionID)?.member_count
          }
        />
      </div>
      <AddToCollectionModal
        isOpen={showAddModal}
        selectedSavedIDs={[...selectedIDs]}
        collections={collections}
        dataSource={dataSource}
        onClose={() => setShowAddModal(false)}
        onSaved={handleSavedToCollection}
        onCollectionCreated={handleCollectionCreatedFromDialog}
      />
      <CollectionFormModal
        isOpen={showCreateModal}
        onSubmit={handleCreateCollection}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
}
