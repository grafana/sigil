import React, { useCallback, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Icon, Spinner, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { ConversationSearchResult } from '../../conversation/types';
import { inferProviderFromModelName } from '../../modelcard/resolve';
import type { ModelCard } from '../../modelcard/types';
import { getProviderColor, getProviderMeta, stripProviderPrefix, toDisplayProvider } from './providerMeta';

export type ConversationListPanelProps = {
  conversations: ConversationSearchResult[];
  selectedConversationId: string;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  showExtendedColumns?: boolean;
  modelCards?: Map<string, ModelCard>;
  getConversationHref?: (conversationId: string) => string;
  onSelectConversation: (conversationId: string) => void;
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

function truncateId(id: string, length = 8): string {
  if (id.length <= length) {
    return id;
  }
  return `${id.slice(0, length)}...`;
}

const MAX_VISIBLE_PILLS = 3;

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    label: 'conversationListPanel-table',
    width: '100%',
    borderCollapse: 'separate' as const,
    borderSpacing: 0,
    tableLayout: 'fixed' as const,
  }),
  headerRow: css({
    label: 'conversationListPanel-headerRow',
  }),
  headerCell: css({
    label: 'conversationListPanel-headerCell',
    padding: theme.spacing(1, 1.5),
    textAlign: 'left' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    top: 0,
    background: theme.colors.background.primary,
    zIndex: 2,
  }),
  row: css({
    label: 'conversationListPanel-row',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowError: css({
    label: 'conversationListPanel-rowError',
    '& td:first-child': {
      position: 'relative',
      '&::before': {
        content: '""',
        position: 'absolute',
        left: 0,
        top: '20%',
        bottom: '20%',
        width: 3,
        borderRadius: 2,
        background: theme.colors.error.main,
      },
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
    verticalAlign: 'top' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
  idCell: css({
    label: 'conversationListPanel-idCell',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
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
  pillList: css({
    label: 'conversationListPanel-pillList',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
    overflow: 'hidden',
  }),
  agentPill: css({
    label: 'conversationListPanel-agentPill',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.25, 0.75),
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1,
    whiteSpace: 'nowrap' as const,
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    background: theme.colors.info.transparent,
    color: theme.colors.info.text,
    border: `1px solid ${theme.colors.info.border}`,
  }),
  modelChip: css({
    label: 'conversationListPanel-modelChip',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0.75),
    borderRadius: '12px',
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1,
    whiteSpace: 'nowrap' as const,
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  modelChipDot: css({
    label: 'conversationListPanel-modelChipDot',
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  overflowPill: css({
    label: 'conversationListPanel-overflowPill',
    display: 'inline-flex',
    alignItems: 'center',
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1,
    color: theme.colors.text.secondary,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
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
    display: 'inline-block',
    minWidth: 40,
    textAlign: 'right' as const,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
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
  colLastActivity: css({ width: 100 }),
  colConversation: css({ width: 180 }),
  colActivity: css({ width: 140 }),
  colAgents: css({ width: '20%' }),
  colModels: css({ width: '25%' }),
  colQuality: css({ width: 130 }),
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

function AgentPillList({ items }: { items: string[] }) {
  const styles = useStyles2(getStyles);
  if (items.length === 0) {
    return <Text color="secondary">-</Text>;
  }

  const visible = items.slice(0, MAX_VISIBLE_PILLS);
  const overflow = items.length - MAX_VISIBLE_PILLS;

  return (
    <div className={styles.pillList}>
      {visible.map((item) => (
        <Tooltip key={item} content={item}>
          <span className={styles.agentPill}>
            <Icon name="user" size="xs" />
            {item}
          </span>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip content={items.slice(MAX_VISIBLE_PILLS).join(', ')}>
          <span className={styles.overflowPill}>+{overflow}</span>
        </Tooltip>
      )}
    </div>
  );
}

function resolveModelDisplay(
  model: string,
  modelCards?: Map<string, ModelCard>
): { displayName: string; color: string } {
  const apiProvider = inferProviderFromModelName(model);

  if (modelCards && modelCards.size > 0 && apiProvider) {
    const card = modelCards.get(`${apiProvider}::${model}`);
    if (card) {
      const displayProv = toDisplayProvider(card.provider);
      const cleanName = stripProviderPrefix(card.name || card.source_model_id, getProviderMeta(displayProv).label);
      return { displayName: cleanName, color: getProviderColor(displayProv) };
    }
  }

  const displayProv = toDisplayProvider(apiProvider);
  const meta = getProviderMeta(displayProv);
  return { displayName: stripProviderPrefix(model, meta.label), color: getProviderColor(displayProv) };
}

function ModelPillList({ models, modelCards }: { models: string[]; modelCards?: Map<string, ModelCard> }) {
  const styles = useStyles2(getStyles);
  if (models.length === 0) {
    return <Text color="secondary">-</Text>;
  }

  const visible = models.slice(0, MAX_VISIBLE_PILLS);
  const overflow = models.length - MAX_VISIBLE_PILLS;

  return (
    <div className={styles.pillList}>
      {visible.map((model) => {
        const { displayName, color } = resolveModelDisplay(model, modelCards);
        return (
          <Tooltip key={model} content={model}>
            <span className={styles.modelChip}>
              <span className={styles.modelChipDot} style={{ background: color }} />
              {displayName}
            </span>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <Tooltip content={models.slice(MAX_VISIBLE_PILLS).join(', ')}>
          <span className={styles.overflowPill}>+{overflow}</span>
        </Tooltip>
      )}
    </div>
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
  getConversationHref,
  onSelectConversation,
  onLoadMore,
}: ConversationListPanelProps) {
  const styles = useStyles2(getStyles);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, conversationId: string) => {
      if ((e.metaKey || e.ctrlKey) && getConversationHref) {
        window.open(getConversationHref(conversationId), '_blank');
        return;
      }
      onSelectConversation(conversationId);
    },
    [getConversationHref, onSelectConversation]
  );

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

  if (!showExtendedColumns) {
    return (
      <div className={styles.container}>
        <div className={styles.listScroll}>
          <table className={styles.table}>
            <tbody>
              {conversations.map((conversation) => {
                const selected = conversation.conversation_id === selectedConversationId;
                return (
                  <tr
                    key={conversation.conversation_id}
                    className={cx(
                      styles.row,
                      selected && styles.rowSelected,
                      conversation.has_errors && styles.rowError
                    )}
                    onClick={(e) => handleRowClick(e, conversation.conversation_id)}
                    role="button"
                    aria-label={`select conversation ${conversation.conversation_id}`}
                    aria-selected={selected}
                  >
                    <td className={cx(styles.cell, styles.timeCell, styles.timeCellCompact)}>
                      <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
                        <span>{formatRelativeTime(conversation.last_generation_at)}</span>
                      </Tooltip>
                    </td>
                    <td className={cx(styles.cell, styles.idCellTruncated)}>
                      <span>{conversation.conversation_id}</span>
                    </td>
                  </tr>
                );
              })}
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

  return (
    <div className={styles.container}>
      <div className={styles.listScroll}>
        <table className={styles.table}>
          <colgroup>
            <col className={styles.colLastActivity} />
            <col className={styles.colConversation} />
            <col className={styles.colActivity} />
            <col className={styles.colAgents} />
            <col className={styles.colModels} />
            <col className={styles.colQuality} />
          </colgroup>
          <thead>
            <tr className={styles.headerRow}>
              <th className={styles.headerCell}>Last activity</th>
              <th className={styles.headerCell}>Conversation</th>
              <th className={styles.headerCell}>Activity</th>
              <th className={styles.headerCell}>Agents</th>
              <th className={styles.headerCell}>Models</th>
              <th className={styles.headerCell}>Quality</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((conversation) => {
              const selected = conversation.conversation_id === selectedConversationId;
              const rating = conversation.rating_summary;
              return (
                <tr
                  key={conversation.conversation_id}
                  className={cx(styles.row, selected && styles.rowSelected, conversation.has_errors && styles.rowError)}
                  onClick={(e) => handleRowClick(e, conversation.conversation_id)}
                  role="button"
                  aria-label={`select conversation ${conversation.conversation_id}`}
                  aria-selected={selected}
                >
                  <td className={cx(styles.cell, styles.timeCell)}>
                    <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
                      <span>{formatRelativeTime(conversation.last_generation_at)}</span>
                    </Tooltip>
                  </td>
                  <td className={styles.cell}>
                    <div className={styles.idCell}>
                      <Tooltip content={conversation.conversation_id}>
                        <span>{truncateId(conversation.conversation_id)}</span>
                      </Tooltip>
                      <CopyIdButton id={conversation.conversation_id} />
                    </div>
                  </td>
                  <td className={styles.cell}>
                    <div className={styles.groupedCell}>
                      <span className={styles.durationCell}>
                        {formatDuration(conversation.first_generation_at, conversation.last_generation_at)}
                      </span>
                      <span className={styles.groupedSeparator}>·</span>
                      <span>{conversation.generation_count} calls</span>
                    </div>
                  </td>
                  <td className={styles.cell}>
                    <AgentPillList items={conversation.agents} />
                  </td>
                  <td className={styles.cell}>
                    <ModelPillList models={conversation.models} modelCards={modelCards} />
                  </td>
                  <td className={styles.cell}>
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
                  </td>
                </tr>
              );
            })}
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
