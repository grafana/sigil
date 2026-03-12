import React from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Input, Spinner, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, buildConversationExploreRoute } from '../../constants';
import type { SavedConversation } from '../../evaluation/types';

export type SavedConversationsListProps = {
  conversations: SavedConversation[];
  isLoading: boolean;
  selectedIDs: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  activeCollectionID: string | null;
  onAddToCollection: () => void;
  onRemoveFromCollection: (ids: Set<string>) => void;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onPageChange: (direction: 'next' | 'prev') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  }),
  toolbar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  searchInput: css({
    flex: 1,
  }),
  selectionInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1.5),
    background: `${theme.colors.primary.transparent}`,
    border: `1px solid ${theme.colors.primary.border}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary.text,
  }),
  divider: css({
    width: 1,
    height: 14,
    background: theme.colors.primary.border,
  }),
  selectionAction: css({
    cursor: 'pointer',
    fontWeight: theme.typography.fontWeightMedium,
    '&:hover': { textDecoration: 'underline' },
  }),
  removeAction: css({
    cursor: 'pointer',
    color: theme.colors.error.text,
    '&:hover': { textDecoration: 'underline' },
  }),
  colHeaders: css({
    display: 'grid',
    gridTemplateColumns: '32px 1fr 140px 120px',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }),
  rows: css({
    flex: 1,
    overflowY: 'auto',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '32px 1fr 140px 120px',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:hover': { background: theme.colors.action.hover },
  }),
  rowSelected: css({
    background: `${theme.colors.primary.transparent} !important`,
    borderLeft: `2px solid ${theme.colors.primary.main}`,
    paddingLeft: `calc(${theme.spacing(2)} - 2px)`,
  }),
  conversationName: css({
    color: theme.colors.text.link,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '&:hover': { textDecoration: 'underline' },
  }),
  paginationActions: css({
    display: 'flex',
    gap: theme.spacing(1),
  }),
  secondary: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
  }),
  emptyState: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    padding: theme.spacing(6),
  }),
  spinnerContainer: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  }),
  pagination: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(1, 2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

export function SavedConversationsList({
  conversations,
  isLoading,
  selectedIDs,
  onSelectionChange,
  activeCollectionID,
  onAddToCollection,
  onRemoveFromCollection,
  hasNextPage,
  hasPrevPage,
  onPageChange,
  searchQuery,
  onSearchChange,
}: SavedConversationsListProps) {
  const styles = useStyles2(getStyles);

  const filtered = searchQuery
    ? conversations.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;

  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIDs.has(c.saved_id));

  const toggleSelectAll = () => {
    if (allSelected) {
      const next = new Set(selectedIDs);
      filtered.forEach((c) => next.delete(c.saved_id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIDs);
      filtered.forEach((c) => next.add(c.saved_id));
      onSelectionChange(next);
    }
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedIDs);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  const hasSelection = selectedIDs.size > 0;

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        {hasSelection ? (
          <div className={styles.selectionInfo}>
            <span>{selectedIDs.size} selected</span>
            <span className={styles.divider} />
            <span className={styles.selectionAction} onClick={onAddToCollection}>
              Add to collection ›
            </span>
            {activeCollectionID !== null && (
              <>
                <span className={styles.divider} />
                <span className={styles.removeAction} onClick={() => onRemoveFromCollection(selectedIDs)}>
                  Remove
                </span>
              </>
            )}
          </div>
        ) : (
          <Input
            className={styles.searchInput}
            prefix={<Icon name="search" />}
            placeholder="Search saved conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
          />
        )}
      </div>

      {/* Column headers */}
      <div className={styles.colHeaders}>
        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
        <span>Name</span>
        <span>Saved by</span>
        <span>Date</span>
      </div>

      {/* Rows */}
      {isLoading ? (
        <div className={styles.spinnerContainer} data-testid="loading-spinner">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Icon name="folder-open" size="xxl" />
          <span>{searchQuery ? 'No conversations match your search' : 'No saved conversations yet'}</span>
        </div>
      ) : (
        <div className={styles.rows}>
          {filtered.map((sc) => (
            <div
              key={sc.saved_id}
              className={`${styles.row} ${selectedIDs.has(sc.saved_id) ? styles.rowSelected : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedIDs.has(sc.saved_id)}
                onChange={() => toggleRow(sc.saved_id)}
                aria-label={`Select ${sc.name}`}
              />
              <a
                className={styles.conversationName}
                href={`${PLUGIN_BASE}/${buildConversationExploreRoute(sc.conversation_id)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sc.name}
              </a>
              <span className={styles.secondary}>{sc.saved_by || '—'}</span>
              <span className={styles.secondary}>{dateTime(sc.created_at).format('MMM D, YYYY')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className={styles.pagination}>
        <span>{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</span>
        <div className={styles.paginationActions}>
          {hasPrevPage && (
            <Button variant="secondary" size="sm" onClick={() => onPageChange('prev')}>
              ← Prev
            </Button>
          )}
          {hasNextPage && (
            <Button variant="secondary" size="sm" onClick={() => onPageChange('next')}>
              Next →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
