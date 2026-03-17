import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, ConfirmModal, Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import type { Collection } from '../../evaluation/types';

export type CollectionsSidebarProps = {
  collections: Collection[];
  totalCount: number;
  activeCollectionID: string | null;
  onSelect: (id: string | null) => void;
  onCreateCollection: () => void;
  onRenameCollection: (id: string, name: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  width?: number;
};

type MenuPosition = { top: number; right: number };
type MenuState = { collectionID: string; type: 'menu' | 'rename' | 'delete'; menuPosition?: MenuPosition } | null;

const getStyles = (theme: GrafanaTheme2) => ({
  sidebar: css({
    flexShrink: 0,
    borderRight: `1px solid ${theme.colors.border.weak}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100%',
  }),
  scrollArea: css({
    flex: 1,
    overflowY: 'auto',
    padding: theme.spacing(1, 1, 0),
  }),
  allSaved: css({
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    marginBottom: theme.spacing(1),
    '&:hover': { background: theme.colors.action.hover },
  }),
  allSavedActive: css({
    background: `${theme.colors.primary.transparent} !important`,
  }),
  sectionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: theme.spacing(1, 1, 0.5),
  }),
  collectionItem: css({
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
    '&:hover [data-kebab]': { visibility: 'visible' },
  }),
  collectionItemActive: css({
    background: `${theme.colors.primary.transparent} !important`,
  }),
  collectionName: css({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.body.fontSize,
  }),
  count: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    marginLeft: theme.spacing(0.5),
  }),
  kebab: css({
    visibility: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'center',
  }),
  menuPopover: css({
    position: 'fixed',
    zIndex: 1000,
    background: theme.colors.background.elevated,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5),
    minWidth: 120,
  }),
  menuItem: css({
    padding: theme.spacing(0.75, 1.5),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    fontSize: theme.typography.body.fontSize,
    '&:hover': { background: theme.colors.action.hover },
  }),
  menuItemDanger: css({
    color: theme.colors.error.text,
  }),
  renameInput: css({
    flex: 1,
  }),
  searchWrapper: css({
    padding: theme.spacing(1, 1, 0),
    flexShrink: 0,
  }),
  footer: css({
    padding: theme.spacing(0, 2),
    height: theme.spacing(6),
    flexShrink: 0,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    display: 'flex',
    alignItems: 'center',
  }),
  newCollectionBtn: css({
    width: '100%',
  }),
});

export function CollectionsSidebar({
  collections,
  totalCount,
  activeCollectionID,
  onSelect,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  width = 200,
}: CollectionsSidebarProps) {
  const styles = useStyles2(getStyles);
  const [menuState, setMenuState] = useState<MenuState>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | undefined>();
  const [collectionSearch, setCollectionSearch] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const prevNameRef = useRef('');

  useEffect(() => {
    if (menuState?.type === 'rename') {
      renameInputRef.current?.focus();
    }
  }, [menuState]);

  useEffect(() => {
    if (menuState?.type !== 'menu') {
      return;
    }
    const close = () => setMenuState(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [menuState]);

  const openMenu = (e: React.MouseEvent, collectionID: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuPosition: MenuPosition = {
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    };
    setMenuState({ collectionID, type: 'menu', menuPosition });
  };

  const startRename = (collection: Collection) => {
    prevNameRef.current = collection.name;
    setRenameValue(collection.name);
    setRenameError(undefined);
    setMenuState({ collectionID: collection.collection_id, type: 'rename' });
  };

  const confirmRename = async (collectionID: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('Name cannot be empty');
      return;
    }
    try {
      await onRenameCollection(collectionID, trimmed);
      setMenuState(null);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Rename failed');
      setRenameValue(prevNameRef.current);
    }
  };

  const cancelRename = () => {
    setMenuState(null);
    setRenameError(undefined);
  };

  const collectionToDelete = collections.find(
    (c) => menuState?.type === 'delete' && c.collection_id === menuState.collectionID
  );

  const filteredCollections = collectionSearch
    ? collections.filter((c) => c.name.toLowerCase().includes(collectionSearch.toLowerCase()))
    : collections;

  return (
    <div className={styles.sidebar} style={{ width }}>
      <div className={styles.scrollArea}>
        {/* All saved */}
        <div
          className={`${styles.allSaved} ${activeCollectionID === null ? styles.allSavedActive : ''}`}
          onClick={() => onSelect(null)}
        >
          <span>All saved</span>
          <span className={styles.count}>{totalCount}</span>
        </div>

        <div className={styles.sectionLabel}>Collections</div>

        {collections.length > 5 && (
          <div className={styles.searchWrapper}>
            <Input
              prefix={<Icon name="search" />}
              placeholder="Filter collections..."
              value={collectionSearch}
              onChange={(e) => setCollectionSearch(e.currentTarget.value)}
            />
          </div>
        )}

        {filteredCollections.map((col) => {
          const isRenaming = menuState?.type === 'rename' && menuState.collectionID === col.collection_id;
          const isActive = activeCollectionID === col.collection_id;

          return (
            <React.Fragment key={col.collection_id}>
              <div
                className={`${styles.collectionItem} ${isActive ? styles.collectionItemActive : ''}`}
                onClick={() => !isRenaming && onSelect(col.collection_id)}
              >
                {isRenaming ? (
                  <>
                    <Input
                      ref={renameInputRef}
                      className={styles.renameInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.currentTarget.value)}
                      invalid={!!renameError}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          confirmRename(col.collection_id);
                        }
                        if (e.key === 'Escape') {
                          cancelRename();
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <IconButton
                      name="check"
                      tooltip="Confirm rename"
                      onClick={() => confirmRename(col.collection_id)}
                    />
                    <IconButton name="times" tooltip="Cancel rename" onClick={cancelRename} />
                  </>
                ) : (
                  <>
                    <span className={styles.collectionName}>{col.name}</span>
                    <span className={styles.count}>{col.member_count}</span>
                    <span data-kebab className={styles.kebab}>
                      <IconButton
                        name="ellipsis-v"
                        tooltip="Collection options"
                        aria-label="collection options"
                        size="sm"
                        onClick={(e) => openMenu(e, col.collection_id)}
                      />
                    </span>
                    {menuState?.type === 'menu' && menuState.collectionID === col.collection_id && (
                      <div
                        className={styles.menuPopover}
                        style={{ top: menuState.menuPosition?.top, right: menuState.menuPosition?.right }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div
                          className={styles.menuItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(col);
                          }}
                        >
                          Rename
                        </div>
                        <div
                          className={`${styles.menuItem} ${styles.menuItemDanger}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuState({ collectionID: col.collection_id, type: 'delete' });
                          }}
                        >
                          Delete
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {isRenaming && renameError && <Alert severity="error" title={renameError} style={{ marginTop: 4 }} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className={styles.footer}>
        <Button variant="primary" icon="plus" className={styles.newCollectionBtn} onClick={onCreateCollection}>
          New collection
        </Button>
      </div>

      {collectionToDelete && (
        <ConfirmModal
          isOpen
          title="Delete collection"
          body={`Delete "${collectionToDelete.name}"? This removes the collection and its ${collectionToDelete.member_count} membership links. The conversations themselves will not be deleted.`}
          confirmText="Delete collection"
          onConfirm={async () => {
            await onDeleteCollection(collectionToDelete.collection_id);
            setMenuState(null);
          }}
          onDismiss={() => setMenuState(null)}
          confirmButtonVariant="destructive"
        />
      )}
    </div>
  );
}
