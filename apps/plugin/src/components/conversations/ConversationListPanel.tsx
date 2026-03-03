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
  showExtendedColumns?: boolean;
  onSelectConversation: (conversationId: string) => void;
  onLoadMore: () => void;
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDayHeader(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function dayKey(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return 'invalid-date';
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    label: 'conversationListPanel-table',
    width: '100%',
    borderCollapse: 'collapse' as const,
  }),
  tableAutoWidth: css({
    label: 'conversationListPanel-tableAutoWidth',
    width: 'max-content',
  }),
  headerRow: css({
    label: 'conversationListPanel-headerRow',
    borderBottom: `2px solid ${theme.colors.border.medium}`,
  }),
  headerCell: css({
    label: 'conversationListPanel-headerCell',
    padding: theme.spacing(1, 1.5),
    textAlign: 'left' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap' as const,
  }),
  row: css({
    label: 'conversationListPanel-row',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    transition: 'background 0.1s ease',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    label: 'conversationListPanel-rowSelected',
    background: theme.colors.primary.transparent,
    '&:hover': {
      background: theme.colors.primary.transparent,
    },
  }),
  cell: css({
    label: 'conversationListPanel-cell',
    padding: theme.spacing(1, 1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    verticalAlign: 'middle' as const,
  }),
  idCell: css({
    label: 'conversationListPanel-idCell',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'normal' as const,
    overflowWrap: 'anywhere' as const,
  }),
  idCellTruncated: css({
    label: 'conversationListPanel-idCellTruncated',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 0,
  }),
  modelList: css({
    label: 'conversationListPanel-modelList',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
  ratingGroup: css({
    label: 'conversationListPanel-ratingGroup',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
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
  dayHeaderRow: css({
    label: 'conversationListPanel-dayHeaderRow',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  dayHeaderCell: css({
    label: 'conversationListPanel-dayHeaderCell',
    padding: theme.spacing(0.75, 1.5),
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
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
  }),
});

export default function ConversationListPanel({
  conversations,
  selectedConversationId,
  loading,
  hasMore,
  loadingMore,
  showExtendedColumns = false,
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
      <div className={styles.listScroll}>
        <table className={cx(styles.table, showExtendedColumns && styles.tableAutoWidth)}>
          {showExtendedColumns && (
            <thead>
              <tr className={styles.headerRow}>
                <th className={styles.headerCell}>Last activity</th>
                <th className={styles.headerCell}>Conversation</th>
                <th className={styles.headerCell}>LLM calls</th>
                <th className={styles.headerCell}>Models</th>
                <th className={styles.headerCell}>Errors</th>
                <th className={styles.headerCell}>Rating</th>
              </tr>
            </thead>
          )}
          <tbody>
            {(() => {
              const rows: React.ReactNode[] = [];
              let previousDayKey = '';
              const dayHeaderColSpan = showExtendedColumns ? 6 : 2;

              for (const conversation of conversations) {
                const currentDayKey = dayKey(conversation.last_generation_at);
                if (currentDayKey !== previousDayKey) {
                  previousDayKey = currentDayKey;
                  rows.push(
                    <tr key={`day-${currentDayKey}`} className={styles.dayHeaderRow}>
                      <td className={styles.dayHeaderCell} colSpan={dayHeaderColSpan}>
                        {formatDayHeader(conversation.last_generation_at)}
                      </td>
                    </tr>
                  );
                }

                const selected = conversation.conversation_id === selectedConversationId;
                const rating = conversation.rating_summary;
                rows.push(
                  <tr
                    key={conversation.conversation_id}
                    className={cx(styles.row, selected && styles.rowSelected)}
                    onClick={() => onSelectConversation(conversation.conversation_id)}
                    role="button"
                    aria-label={`select conversation ${conversation.conversation_id}`}
                    aria-selected={selected}
                  >
                    <td className={cx(styles.cell, styles.timeCell, !showExtendedColumns && styles.timeCellCompact)}>
                      <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
                        <span>{formatTime(conversation.last_generation_at)}</span>
                      </Tooltip>
                    </td>
                    <td className={cx(styles.cell, styles.idCell, !showExtendedColumns && styles.idCellTruncated)}>
                      <span>{conversation.conversation_id}</span>
                    </td>
                    {showExtendedColumns && (
                      <>
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
                      </>
                    )}
                  </tr>
                );
              }
              return rows;
            })()}
          </tbody>
        </table>
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
