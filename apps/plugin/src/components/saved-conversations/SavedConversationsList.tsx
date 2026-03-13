import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Checkbox, ConfirmModal, Icon, Input, MultiSelect, Spinner, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, buildConversationExploreRoute } from '../../constants';
import type { SavedConversation } from '../../evaluation/types';

type SortCol = 'name' | 'gens' | 'tokens' | 'saved_by' | 'created_at';
type SortDir = 'asc' | 'desc';

export type SavedConversationsListProps = {
  conversations: SavedConversation[];
  isLoading: boolean;
  selectedIDs: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  activeCollectionID: string | null;
  onAddToCollection: () => void;
  onRemoveFromCollection: (ids: Set<string>) => void;
  onUnsave: (ids: Set<string>) => void;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onPageChange: (direction: 'next' | 'prev') => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalCount?: number;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
    minHeight: 0,
  }),
  toolbar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  searchInput: css({
    width: 240,
    flexShrink: 0,
    marginLeft: 'auto',
  }),
  selectionInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  multiSelectWrap: css({
    '& [class*="grafana-select-value-container"]': {
      flexWrap: 'nowrap',
      overflow: 'hidden',
      height: 30,
      alignItems: 'center',
    },
  }),
  colHeaders: css({
    display: 'grid',
    gridTemplateColumns: '32px 2fr 1fr 60px 80px 120px 110px',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
  }),
  colHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    cursor: 'pointer',
    userSelect: 'none',
    '&:hover': { color: theme.colors.text.primary },
  }),
  colHeaderActive: css({
    color: theme.colors.text.primary,
  }),
  rows: css({
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '32px 2fr 1fr 60px 80px 120px 110px',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    alignItems: 'start',
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
  secondary: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  agentBadges: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    alignItems: 'center',
    minWidth: 0,
  }),
  agentOverflow: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
    flexShrink: 0,
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
    padding: theme.spacing(0, 2),
    height: theme.spacing(6),
    flexShrink: 0,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    gap: theme.spacing(2),
  }),
  pageSizeSelect: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexShrink: 0,
  }),
  select: css({
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: theme.spacing(0, 0.5),
    cursor: 'pointer',
    width: 65,
    height: 24,
  }),
  pageNav: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
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
  onUnsave,
  hasNextPage,
  hasPrevPage,
  onPageChange,
  pageSize,
  onPageSizeChange,
  searchQuery,
  onSearchChange,
  totalCount,
}: SavedConversationsListProps) {
  const styles = useStyles2(getStyles);
  const [showUnsaveConfirm, setShowUnsaveConfirm] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [savedByFilter, setSavedByFilter] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState<string[]>([]);

  const savedByOptions = useMemo(
    () => Array.from(new Set(conversations.map((c) => c.saved_by).filter(Boolean))).sort(),
    [conversations]
  );

  const agentOptions = useMemo(
    () => Array.from(new Set(conversations.flatMap((c) => c.agent_names ?? []))).sort(),
    [conversations]
  );

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    let result = conversations;
    if (searchQuery) {
      result = result.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (savedByFilter.length > 0) {
      result = result.filter((c) => savedByFilter.includes(c.saved_by ?? ''));
    }
    if (agentFilter.length > 0) {
      result = result.filter((c) => agentFilter.some((a) => (c.agent_names ?? []).includes(a)));
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortCol === 'name') {
          cmp = a.name.localeCompare(b.name);
        } else if (sortCol === 'gens') {
          cmp = a.generation_count - b.generation_count;
        } else if (sortCol === 'tokens') {
          cmp = a.total_tokens - b.total_tokens;
        } else if (sortCol === 'saved_by') {
          cmp = (a.saved_by ?? '').localeCompare(b.saved_by ?? '');
        } else if (sortCol === 'created_at') {
          cmp = a.created_at.localeCompare(b.created_at);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [conversations, searchQuery, savedByFilter, agentFilter, sortCol, sortDir]);

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
        <div className={styles.selectionInfo}>
          {hasSelection && <span>{selectedIDs.size} selected</span>}
          <Button variant="secondary" icon="folder-plus" disabled={!hasSelection} onClick={onAddToCollection}>
            Add to collection
          </Button>
          {activeCollectionID !== null && (
            <Button
              variant="secondary"
              icon="minus-circle"
              disabled={!hasSelection}
              onClick={() => onRemoveFromCollection(selectedIDs)}
            >
              Remove from collection
            </Button>
          )}
          <Button
            variant="destructive"
            icon="trash-alt"
            disabled={!hasSelection}
            onClick={() => setShowUnsaveConfirm(true)}
          >
            Unsave
          </Button>
        </div>
        {agentOptions.length > 0 && (
          <div className={styles.multiSelectWrap}>
            <MultiSelect
              width={20}
              placeholder="All agents"
              maxVisibleValues={1}
              options={agentOptions.map((a) => ({ label: a, value: a }))}
              value={agentFilter}
              onChange={(opts) => setAgentFilter(opts.map((o) => o.value!))}
            />
          </div>
        )}
        {savedByOptions.length > 0 && (
          <div className={styles.multiSelectWrap}>
            <MultiSelect
              width={16}
              placeholder="All users"
              maxVisibleValues={1}
              options={savedByOptions.map((u) => ({ label: u, value: u }))}
              value={savedByFilter}
              onChange={(opts) => setSavedByFilter(opts.map((o) => o.value!))}
            />
          </div>
        )}
        <Input
          className={styles.searchInput}
          prefix={<Icon name="search" />}
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
        />
      </div>

      {/* Column headers */}
      <div className={styles.colHeaders}>
        <Checkbox value={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
        {(['name', 'Agents', 'gens', 'tokens', 'saved_by', 'created_at'] as const).map((col) => {
          const label: Record<string, string> = {
            name: 'Name',
            Agents: 'Agents',
            gens: 'Gens',
            tokens: 'Tokens',
            saved_by: 'Saved by',
            created_at: 'Saved',
          };
          if (col === 'Agents') {
            return <span key={col}>Agents</span>;
          }
          const isActive = sortCol === col;
          return (
            <span
              key={col}
              className={`${styles.colHeader} ${isActive ? styles.colHeaderActive : ''}`}
              onClick={() => toggleSort(col as SortCol)}
            >
              {label[col]}
              {isActive ? (
                <Icon name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size="xs" />
              ) : (
                <Icon name="arrows-v" size="xs" />
              )}
            </span>
          );
        })}
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
              <Checkbox
                value={selectedIDs.has(sc.saved_id)}
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
              <div className={styles.agentBadges}>
                {(sc.agent_names ?? []).length === 0 ? (
                  <span className={styles.secondary}>—</span>
                ) : (
                  <>
                    {(sc.agent_names ?? []).slice(0, 5).map((name) => (
                      <Badge key={name} text={name} color="darkgrey" title={name} />
                    ))}
                    {(sc.agent_names ?? []).length > 5 && <span className={styles.agentOverflow}>…</span>}
                  </>
                )}
              </div>
              <span className={styles.secondary}>{sc.generation_count > 0 ? sc.generation_count : '—'}</span>
              <span className={styles.secondary}>{sc.total_tokens > 0 ? sc.total_tokens.toLocaleString() : '—'}</span>
              <span className={styles.secondary}>{sc.saved_by || '—'}</span>
              <span className={styles.secondary}>{dateTime(sc.created_at).format('MMM D, YYYY')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className={styles.pagination}>
        <span>
          {totalCount ?? conversations.length} conversation{(totalCount ?? conversations.length) !== 1 ? 's' : ''}
        </span>
        <div className={styles.pageNav}>
          <div className={styles.pageSizeSelect}>
            <span>Rows per page</span>
            <select
              className={styles.select}
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <Button variant="secondary" size="sm" disabled={!hasPrevPage} onClick={() => onPageChange('prev')}>
            ← Prev
          </Button>
          <Button variant="secondary" size="sm" disabled={!hasNextPage} onClick={() => onPageChange('next')}>
            Next →
          </Button>
        </div>
      </div>
      <ConfirmModal
        isOpen={showUnsaveConfirm}
        title="Unsave conversations"
        body={`Remove ${selectedIDs.size} conversation${selectedIDs.size !== 1 ? 's' : ''} from saved? This cannot be undone.`}
        confirmText="Unsave"
        confirmButtonVariant="destructive"
        onConfirm={() => {
          setShowUnsaveConfirm(false);
          onUnsave(selectedIDs);
        }}
        onDismiss={() => setShowUnsaveConfirm(false)}
      />
    </div>
  );
}
