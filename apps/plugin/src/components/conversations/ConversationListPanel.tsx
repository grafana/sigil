import React, { useCallback, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Icon, Spinner, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { ConversationSearchResult } from '../../conversation/types';
import type { ModelCard } from '../../modelcard/types';
import { getProviderColor, getProviderMeta, inferProvider, stripProviderPrefix } from './providerMeta';

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

export function formatRelativeTime(dateStr: string): string {
  const ts = Date.parse(dateStr);
  if (!Number.isFinite(ts)) {
    return '-';
  }
  const diffMs = Date.now() - ts;
  if (diffMs < 0) {
    return 'just now';
  }
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
    borderBottom: `2px solid ${theme.colors.border.medium}`,
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
  rowError: css({
    label: 'conversationListPanel-rowError',
    '& td:first-child': {
      boxShadow: `inset 3px 0 0 0 ${theme.colors.error.main}`,
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
  colDuration: css({ width: 80 }),
  colLLMCalls: css({ width: 80 }),
  colAgents: css({ width: '20%' }),
  colModels: css({ width: '20%' }),
  colErrors: css({ width: 70 }),
  colRating: css({ width: 80 }),
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
  modelProviders?: Record<string, string>,
  modelCards?: Map<string, ModelCard>
): { displayName: string; color: string } {
  const provider = modelProviders?.[model] || inferProvider(model);

  if (modelCards && modelCards.size > 0) {
    const key = `${provider}::${model}`;
    const card = modelCards.get(key);
    if (card) {
      const cleanName = stripProviderPrefix(card.name || card.source_model_id, getProviderMeta(card.provider).label);
      return { displayName: cleanName, color: getProviderColor(card.provider) };
    }
  }

  const meta = getProviderMeta(provider);
  return { displayName: stripProviderPrefix(model, meta.label), color: getProviderColor(provider) };
}

function ModelPillList({
  models,
  modelProviders,
  modelCards,
}: {
  models: string[];
  modelProviders?: Record<string, string>;
  modelCards?: Map<string, ModelCard>;
}) {
  const styles = useStyles2(getStyles);
  if (models.length === 0) {
    return <Text color="secondary">-</Text>;
  }

  const visible = models.slice(0, MAX_VISIBLE_PILLS);
  const overflow = models.length - MAX_VISIBLE_PILLS;

  return (
    <div className={styles.pillList}>
      {visible.map((model) => {
        const { displayName, color } = resolveModelDisplay(model, modelProviders, modelCards);
        return (
          <Tooltip key={model} content={model}>
            <span className={styles.modelChip}>
              <span
                className={styles.modelChipDot}
                style={{ background: color }}
              />
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

  if (loading) {
    return (
      <div className={styles.emptyState}>
        <Spinner aria-label="loading conversations" />
      </div>
    );
  }

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
                      <Tooltip
                        content={new Date(conversation.last_generation_at).toLocaleString()}
                        placement="left"
                      >
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
            <col className={styles.colDuration} />
            <col className={styles.colLLMCalls} />
            <col className={styles.colAgents} />
            <col className={styles.colModels} />
            <col className={styles.colErrors} />
            <col className={styles.colRating} />
          </colgroup>
          <thead>
            <tr className={styles.headerRow}>
              <th className={styles.headerCell}>Last activity</th>
              <th className={styles.headerCell}>Conversation</th>
              <th className={styles.headerCell}>Duration</th>
              <th className={styles.headerCell}>LLM calls</th>
              <th className={styles.headerCell}>Agents</th>
              <th className={styles.headerCell}>Models</th>
              <th className={styles.headerCell}>Errors</th>
              <th className={styles.headerCell}>Rating</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((conversation) => {
              const selected = conversation.conversation_id === selectedConversationId;
              const rating = conversation.rating_summary;
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
                  <td className={cx(styles.cell, styles.timeCell)}>
                    <Tooltip
                      content={new Date(conversation.last_generation_at).toLocaleString()}
                      placement="left"
                    >
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
                  <td className={cx(styles.cell, styles.durationCell)}>
                    {formatDuration(
                      conversation.first_generation_at,
                      conversation.last_generation_at
                    )}
                  </td>
                  <td className={styles.cell}>{conversation.generation_count}</td>
                  <td className={styles.cell}>
                    <AgentPillList items={conversation.agents} />
                  </td>
                  <td className={styles.cell}>
                    <ModelPillList
                      models={conversation.models}
                      modelProviders={conversation.model_providers}
                      modelCards={modelCards}
                    />
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
