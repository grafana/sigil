import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Icon, Spinner, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { ConversationSearchResult } from '../../conversation/types';
import type { ModelCard } from '../../modelcard/types';
import DataTable, { type ColumnDef } from '../shared/DataTable';
import AgentChipList from '../shared/AgentChipList';
import ModelChipList from '../shared/ModelChipList';

export type ConversationListPanelProps = {
  conversations: ConversationSearchResult[];
  selectedConversationId: string;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  showExtendedColumns?: boolean;
  modelCards?: Map<string, ModelCard>;
  getConversationTokens?: (conversation: ConversationSearchResult) => number;
  getConversationCacheHitRate?: (conversation: ConversationSearchResult) => number;
  getConversationHref?: (conversationId: string, conversationTitle?: string) => string;
  onSelectConversation: (conversationId: string, conversationTitle?: string) => void;
  onLoadMore: () => void;
};

import { formatRelativeTime } from '../dashboard/dashboardShared';
export { formatRelativeTime };

export function formatDuration(fromStr: string, toStr: string): string {
  const fromTs = Date.parse(fromStr);
  const toTs = Date.parse(toStr);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
    return '-';
  }
  const diffMs = toTs - fromTs;
  if (diffMs < 0) {
    return '-';
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 60) {
    return totalSeconds === 0 ? '< 1s' : `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatTokenCount(tokens: number): string {
  if (tokens <= 0) {
    return '-';
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

function formatCacheHitRate(rate: number): string {
  if (rate <= 0) {
    return '-';
  }
  return `${rate.toFixed(1)}%`;
}

function truncateId(id: string, length = 40): string {
  if (id.length <= length) {
    return id;
  }
  return `${id.slice(0, length)}...`;
}

function conversationTitleForDisplay(conversation: ConversationSearchResult): string {
  const title = conversation.conversation_title?.trim() ?? '';
  if (title.length > 0) {
    return title;
  }
  return conversation.conversation_id;
}

function conversationUserIDForDisplay(conversation: ConversationSearchResult): string {
  const userID = conversation.user_id?.trim() ?? '';
  if (userID.length > 0) {
    return userID;
  }
  return '';
}

const getStyles = (theme: GrafanaTheme2) => ({
  idCell: css({
    label: 'conversationListPanel-idCell',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
  idCellStack: css({
    label: 'conversationListPanel-idCellStack',
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
    lineHeight: 1.2,
    gap: theme.spacing(0.25),
  }),
  idCellPrimary: css({
    label: 'conversationListPanel-idCellPrimary',
    fontFamily: theme.typography.fontFamily,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  idCellSecondary: css({
    label: 'conversationListPanel-idCellSecondary',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: theme.colors.text.secondary,
  }),
  idCellTruncated: css({
    label: 'conversationListPanel-idCellTruncated',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 0,
  }),
  copyButton: css({
    label: 'conversationListPanel-copyButton',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    color: theme.colors.text.secondary,
    opacity: 0,
    transition: 'opacity 0.15s ease',
    flexShrink: 0,
    'tr:hover &': {
      opacity: 1,
    },
    '&:hover': {
      color: theme.colors.text.primary,
    },
  }),
  ratingGroup: css({
    label: 'conversationListPanel-ratingGroup',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  groupedCell: css({
    label: 'conversationListPanel-groupedCell',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    whiteSpace: 'nowrap' as const,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  groupedSeparator: css({
    label: 'conversationListPanel-groupedSeparator',
    color: theme.colors.text.disabled,
  }),
  timeCell: css({
    label: 'conversationListPanel-timeCell',
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap' as const,
  }),
  timeCellCompact: css({
    label: 'conversationListPanel-timeCellCompact',
    width: '1%',
    paddingLeft: theme.spacing(0.75),
    paddingRight: theme.spacing(0.75),
  }),
  durationCell: css({
    label: 'conversationListPanel-durationCell',
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  activityDuration: css({
    label: 'conversationListPanel-activityDuration',
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    minWidth: 48,
    textAlign: 'right' as const,
  }),
  activityCalls: css({
    label: 'conversationListPanel-activityCalls',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: theme.typography.fontWeightBold,
  }),
  callCountCell: css({
    label: 'conversationListPanel-callCountCell',
    fontVariantNumeric: 'tabular-nums',
  }),
  emptyState: css({
    label: 'conversationListPanel-emptyState',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
  }),
  container: css({
    label: 'conversationListPanel-container',
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    gap: theme.spacing(1),
  }),
  listScroll: css({
    label: 'conversationListPanel-listScroll',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    overflowX: 'auto' as const,
    overscrollBehavior: 'none' as const,
  }),
  evalBar: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
  }),
  evalBarTrack: css({
    width: '100%',
    height: 6,
    borderRadius: 3,
    background: theme.colors.error.transparent,
    overflow: 'hidden',
  }),
  evalBarFill: css({
    height: '100%',
    borderRadius: 3,
    background: theme.colors.success.main,
    transition: 'width 200ms ease',
  }),
  evalBarLabel: css({
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    color: theme.colors.text.secondary,
  }),
  evalBarPct: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
});

function CopyIdButton({ id }: { id: string }) {
  const styles = useStyles2(getStyles);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(id).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [id]
  );

  return (
    <Tooltip content={copied ? 'Copied!' : 'Copy full ID'}>
      <button className={styles.copyButton} onClick={handleCopy} aria-label="copy conversation id">
        <Icon name={copied ? 'check' : 'copy'} size="sm" />
      </button>
    </Tooltip>
  );
}

export default function ConversationListPanel({
  conversations,
  selectedConversationId,
  loading,
  hasMore,
  loadingMore,
  showExtendedColumns = false,
  modelCards,
  getConversationTokens,
  getConversationCacheHitRate,
  getConversationHref,
  onSelectConversation,
  onLoadMore,
}: ConversationListPanelProps) {
  const styles = useStyles2(getStyles);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, conversationId: string, conversationTitle?: string) => {
      if ((e.metaKey || e.ctrlKey) && getConversationHref) {
        window.open(getConversationHref(conversationId, conversationTitle), '_blank');
        return;
      }
      onSelectConversation(conversationId, conversationTitle);
    },
    [getConversationHref, onSelectConversation]
  );

  const onDataTableRowClick = useCallback(
    (conversation: ConversationSearchResult, e: React.MouseEvent) => {
      handleRowClick(e, conversation.conversation_id, conversation.conversation_title);
    },
    [handleRowClick]
  );

  const compactColumns = useMemo<Array<ColumnDef<ConversationSearchResult>>>(
    () => [
      {
        id: 'time',
        header: '',
        width: '1%',
        cell: (conversation: ConversationSearchResult) => (
          <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
            <span className={styles.timeCell}>{formatRelativeTime(conversation.last_generation_at)}</span>
          </Tooltip>
        ),
      },
      {
        id: 'conversation',
        header: '',
        cell: (conversation: ConversationSearchResult) => {
          const displayTitle = conversationTitleForDisplay(conversation);
          const hasTitle = displayTitle !== conversation.conversation_id;
          const userID = conversationUserIDForDisplay(conversation);
          return (
            <Tooltip
              content={
                hasTitle ? (
                  <>
                    {displayTitle}
                    <br />
                    {conversation.conversation_id}
                    {userID.length > 0 && (
                      <>
                        <br />
                        {userID}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {conversation.conversation_id}
                    {userID.length > 0 && (
                      <>
                        <br />
                        {userID}
                      </>
                    )}
                  </>
                )
              }
            >
              <div className={styles.idCellStack}>
                <span className={styles.idCellPrimary}>{displayTitle}</span>
                {userID.length > 0 && <span className={styles.idCellSecondary}>{userID}</span>}
              </div>
            </Tooltip>
          );
        },
      },
    ],
    [styles]
  );

  const extendedColumns = useMemo<Array<ColumnDef<ConversationSearchResult>>>(() => {
    const cols: Array<ColumnDef<ConversationSearchResult>> = [
      {
        id: 'lastActivity',
        header: 'Last activity',
        width: 100,
        cell: (conversation: ConversationSearchResult) => (
          <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
            <span className={styles.timeCell}>{formatRelativeTime(conversation.last_generation_at)}</span>
          </Tooltip>
        ),
      },
      {
        id: 'conversation',
        header: 'Conversation',
        width: 280,
        cell: (conversation: ConversationSearchResult) => {
          const displayTitle = conversationTitleForDisplay(conversation);
          const hasTitle = displayTitle !== conversation.conversation_id;
          const userID = conversationUserIDForDisplay(conversation);
          return (
            <div className={styles.idCell}>
              <div className={styles.idCellStack}>
                {hasTitle ? (
                  <Tooltip content={displayTitle}>
                    <span className={styles.idCellPrimary}>{displayTitle}</span>
                  </Tooltip>
                ) : conversation.conversation_id.length > 40 ? (
                  <Tooltip content={conversation.conversation_id}>
                    <span className={styles.idCellPrimary}>{truncateId(conversation.conversation_id)}</span>
                  </Tooltip>
                ) : (
                  <span className={styles.idCellPrimary}>{conversation.conversation_id}</span>
                )}
                {userID.length > 0 && (
                  <Tooltip content={userID}>
                    <span className={styles.idCellSecondary}>{userID}</span>
                  </Tooltip>
                )}
              </div>
              <CopyIdButton id={conversation.conversation_id} />
            </div>
          );
        },
      },
      {
        id: 'activity',
        header: 'Activity',
        width: 140,
        cell: (conversation: ConversationSearchResult) => (
          <div className={styles.groupedCell}>
            <span className={styles.activityDuration}>
              {formatDuration(conversation.first_generation_at, conversation.last_generation_at)}
            </span>
            <span className={styles.groupedSeparator}>·</span>
            <span className={styles.activityCalls}>
              {conversation.generation_count} {conversation.generation_count === 1 ? 'call' : 'calls'}
            </span>
          </div>
        ),
      },
    ];

    if (getConversationTokens) {
      cols.push({
        id: 'tokens',
        header: 'Tokens',
        width: 90,
        cell: (conversation: ConversationSearchResult) => (
          <span className={styles.durationCell}>{formatTokenCount(getConversationTokens(conversation))}</span>
        ),
      });
    }

    if (getConversationCacheHitRate) {
      cols.push({
        id: 'cacheHit',
        header: 'Cache hit',
        width: 100,
        cell: (conversation: ConversationSearchResult) => (
          <span className={styles.durationCell}>{formatCacheHitRate(getConversationCacheHitRate(conversation))}</span>
        ),
      });
    }

    cols.push(
      {
        id: 'agents',
        header: 'Agents',
        width: '20%',
        cell: (conversation: ConversationSearchResult) => <AgentChipList agents={conversation.agents} />,
      },
      {
        id: 'models',
        header: 'Models',
        width: '15%',
        cell: (conversation: ConversationSearchResult) => (
          <ModelChipList models={conversation.models} modelCards={modelCards} />
        ),
      },
      {
        id: 'quality',
        header: 'Quality',
        width: 100,
        cell: (conversation: ConversationSearchResult) => {
          const rating = conversation.rating_summary;
          return (
            <div className={styles.groupedCell}>
              {conversation.error_count > 0 ? (
                <Badge text={String(conversation.error_count)} color="red" />
              ) : (
                <Text color="secondary">-</Text>
              )}
              {rating != null && rating.total_count > 0 && (
                <>
                  <span className={styles.groupedSeparator}>·</span>
                  <div className={styles.ratingGroup}>
                    {rating.good_count > 0 && (
                      <Stack direction="row" gap={0.25} alignItems="center">
                        <Icon name="thumbs-up" size="sm" />
                        <span>{rating.good_count}</span>
                      </Stack>
                    )}
                    {rating.bad_count > 0 && (
                      <Stack direction="row" gap={0.25} alignItems="center">
                        <Icon name="thumbs-down" size="sm" />
                        <span>{rating.bad_count}</span>
                      </Stack>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        },
      },
      {
        id: 'evals',
        header: 'Evals',
        width: 130,
        cell: (conversation: ConversationSearchResult) => {
          if (
            conversation.eval_summary != null &&
            (conversation.eval_summary.pass_count > 0 || conversation.eval_summary.fail_count > 0)
          ) {
            const { pass_count, fail_count } = conversation.eval_summary;
            const total = pass_count + fail_count;
            const pct = total > 0 ? Math.round((pass_count / total) * 100) : 0;
            return (
              <div className={styles.evalBar}>
                <div className={styles.evalBarTrack}>
                  <div className={styles.evalBarFill} style={{ width: `${pct}%` }} />
                </div>
                <div className={styles.evalBarLabel}>
                  <span className={styles.evalBarPct}>{pct}%</span>
                  <span>
                    {pass_count}p · {fail_count}f
                  </span>
                </div>
              </div>
            );
          }
          return <Text color="secondary">-</Text>;
        },
      }
    );

    return cols;
  }, [styles, getConversationTokens, getConversationCacheHitRate, modelCards]);

  if (loading) {
    return (
      <div className={styles.emptyState}>
        <Spinner aria-label="loading conversations" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Icon name="search" size="xl" />
        <Text color="secondary">No conversations found. Apply a filter to start.</Text>
      </div>
    );
  }

  const columns = showExtendedColumns ? extendedColumns : compactColumns;

  return (
    <div className={styles.container}>
      <div className={styles.listScroll}>
        <DataTable
          columns={columns}
          data={conversations}
          keyOf={(c) => c.conversation_id}
          onRowClick={onDataTableRowClick}
          isSelected={(c) => c.conversation_id === selectedConversationId}
          rowVariant={(c) => (c.has_errors ? 'error' : undefined)}
          rowRole="button"
          rowAriaLabel={(c) => `select conversation ${c.conversation_id}`}
          showHeader={showExtendedColumns}
          stickyHeader={showExtendedColumns}
          fixedLayout={true}
        />
      </div>
      {hasMore && (
        <Button
          aria-label="load more conversations"
          onClick={onLoadMore}
          disabled={loadingMore}
          variant="secondary"
          fullWidth
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
