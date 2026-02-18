import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Icon, Spinner, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { ConversationSearchResult } from '../../conversation/types';

export type ConversationListPanelProps = {
  conversations: ConversationSearchResult[];
  selectedConversationId: string;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onSelectConversation: (conversationId: string) => void;
  onLoadMore: () => void;
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + '...' : id;
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    width: '100%',
    borderCollapse: 'collapse' as const,
  }),
  headerRow: css({
    borderBottom: `2px solid ${theme.colors.border.medium}`,
  }),
  headerCell: css({
    padding: theme.spacing(1, 1.5),
    textAlign: 'left' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap' as const,
  }),
  row: css({
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    transition: 'background 0.1s ease',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    background: theme.colors.primary.transparent,
    '&:hover': {
      background: theme.colors.primary.transparent,
    },
  }),
  cell: css({
    padding: theme.spacing(1, 1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    verticalAlign: 'middle' as const,
  }),
  idCell: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  modelList: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
  ratingGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  emptyState: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
  }),
  container: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    overflowY: 'auto' as const,
  }),
});

export default function ConversationListPanel({
  conversations,
  selectedConversationId,
  loading,
  hasMore,
  loadingMore,
  onSelectConversation,
  onLoadMore,
}: ConversationListPanelProps) {
  const styles = useStyles2(getStyles);

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

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.headerCell}>Conversation</th>
            <th className={styles.headerCell}>Gen</th>
            <th className={styles.headerCell}>Models</th>
            <th className={styles.headerCell}>Errors</th>
            <th className={styles.headerCell}>Rating</th>
            <th className={styles.headerCell}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map((conversation) => {
            const selected = conversation.conversation_id === selectedConversationId;
            const rating = conversation.rating_summary;
            return (
              <tr
                key={conversation.conversation_id}
                className={cx(styles.row, selected && styles.rowSelected)}
                onClick={() => onSelectConversation(conversation.conversation_id)}
                role="button"
                aria-label={`select conversation ${conversation.conversation_id}`}
                aria-selected={selected}
              >
                <td className={cx(styles.cell, styles.idCell)}>
                  <Tooltip content={conversation.conversation_id} placement="right">
                    <span>{truncateId(conversation.conversation_id)}</span>
                  </Tooltip>
                </td>
                <td className={styles.cell}>{conversation.generation_count}</td>
                <td className={styles.cell}>
                  <div className={styles.modelList}>
                    {conversation.models.map((model) => (
                      <Badge key={model} text={model} color="blue" />
                    ))}
                    {conversation.models.length === 0 && <Text color="secondary">-</Text>}
                  </div>
                </td>
                <td className={styles.cell}>
                  {conversation.error_count > 0 ? (
                    <Badge text={String(conversation.error_count)} color="red" />
                  ) : (
                    <Text color="secondary">0</Text>
                  )}
                </td>
                <td className={styles.cell}>
                  {rating != null && rating.total_count > 0 ? (
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
                  ) : (
                    <Text color="secondary">-</Text>
                  )}
                </td>
                <td className={styles.cell}>
                  <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
                    <span>{formatRelativeTime(conversation.last_generation_at)}</span>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
