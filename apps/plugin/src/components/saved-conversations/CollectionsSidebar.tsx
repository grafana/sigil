import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, ConfirmModal, IconButton, Input, useStyles2 } from '@grafana/ui';
import type { Collection } from '../../evaluation/types';

export type CollectionsSidebarProps = {
  collections: Collection[];
  totalCount: number;
  activeCollectionID: string | null;
  onSelect: (id: string | null) => void;
  onCreateCollection: () => void;
  onRenameCollection: (id: string, name: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
};

type MenuState = { collectionID: string; type: 'menu' | 'rename' | 'delete' } | null;

const getStyles = (theme: GrafanaTheme2) => ({
  sidebar: css({
    width: 200,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    marginBottom: theme.spacing(1),
    '&:hover': { background: theme.colors.action.hover },
  }),
  allSavedActive: css({
    background: `${theme.colors.primary.transparent} !important`,
    border: `1px solid ${theme.colors.primary.border}`,
  }),
  sectionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: theme.spacing(1, 1, 0.5),
  }),
  collectionItem: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  }),
  menuPopover: css({
    position: 'absolute',
    right: 0,
    top: '100%',
    zIndex: 100,
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
  footer: css({
    padding: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  newCollectionBtn: css({
    width: '100%',
    border: `1px dashed ${theme.colors.primary.border}`,
    background: 'transparent',
    color: theme.colors.primary.text,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.75),
    cursor: 'pointer',
    fontSize: theme.typography.body.fontSize,
    '&:hover': { background: theme.colors.primary.transparent },
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
}: CollectionsSidebarProps) {
  const styles = useStyles2(getStyles);
  const [menuState, setMenuState] = useState<MenuState>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | undefined>();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const prevNameRef = useRef('');

  useEffect(() => {
    if (menuState?.type === 'rename') {
      renameInputRef.current?.focus();
    }
  }, [menuState]);

  useEffect(() => {
    if (menuState?.type !== 'menu') return;
    const handleOutsideClick = () => setMenuState(null);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuState]);

  const openMenu = (e: React.MouseEvent, collectionID: string) => {
    e.stopPropagation();
    setMenuState({ collectionID, type: 'menu' });
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

  return (
    <div className={styles.sidebar}>
      <div className={styles.scrollArea}>
        {/* All saved */}
        <div
          className={`${styles.allSaved} ${activeCollectionID === null ? styles.allSavedActive : ''}`}
          onClick={() => onSelect(null)}
        >
          <span>All saved</span>
          <Badge text={String(totalCount)} color="blue" />
        </div>

        <div className={styles.sectionLabel}>Collections</div>

        {collections.map((col) => {
          const isRenaming = menuState?.type === 'rename' && menuState.collectionID === col.collection_id;
          const isActive = activeCollectionID === col.collection_id;

          return (
            <React.Fragment key={col.collection_id}>
            <div
              className={`${styles.collectionItem} ${isActive ? styles.collectionItemActive : ''}`}
              style={{ position: 'relative' }}
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
                      if (e.key === 'Enter') confirmRename(col.collection_id);
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <IconButton name="check" tooltip="Confirm rename" onClick={() => confirmRename(col.collection_id)} />
                  <IconButton name="times" tooltip="Cancel rename" onClick={cancelRename} />
                </>
              ) : (
                <>
                  <span className={styles.collectionName}>{col.name}</span>
                  <span className={styles.count}>{col.member_count}</span>
                  <span
                    data-kebab
                    className={styles.kebab}
                  >
                    <IconButton
                      name="ellipsis-v"
                      tooltip="Collection options"
                      aria-label="collection options"
                      size="sm"
                      onClick={(e) => openMenu(e, col.collection_id)}
                    />
                  </span>
                  {menuState?.type === 'menu' && menuState.collectionID === col.collection_id && (
                    <div className={styles.menuPopover}>
                      <div className={styles.menuItem} onClick={(e) => { e.stopPropagation(); startRename(col); }}>
                        Rename
                      </div>
                      <div
                        className={`${styles.menuItem} ${styles.menuItemDanger}`}
                        onClick={(e) => { e.stopPropagation(); setMenuState({ collectionID: col.collection_id, type: 'delete' }); }}
                      >
                        Delete
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {isRenaming && renameError && (
              <Alert severity="error" title={renameError} style={{ marginTop: 4 }} />
            )}
            </React.Fragment>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button className={styles.newCollectionBtn} onClick={onCreateCollection}>
          + New collection
        </button>
      </div>

      {collectionToDelete && (
        <ConfirmModal
          isOpen
          title="Delete collection"
          body={`Delete "${collectionToDelete.name}"? This removes the collection and its ${collectionToDelete.member_count} membership links. The conversations themselves will not be deleted.`}
          confirmText="Delete collection"
          onConfirm={async () => {
            await onDeleteCollection(collectionToDelete.collection_id);
            if (activeCollectionID === collectionToDelete.collection_id) {
              onSelect(null);
            }
            setMenuState(null);
          }}
          onDismiss={() => setMenuState(null)}
          confirmButtonVariant="destructive"
        />
      )}
    </div>
  );
}
