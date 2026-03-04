import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { ModelCard } from '../../modelcard/types';
import type { ConversationSearchResult } from '../../conversation/types';
import type { TokenSummary, CostSummary } from '../../conversation/aggregates';
import ModelCardPopover from './ModelCardPopover';
import { getProviderColor, stripProviderPrefix } from './providerMeta';

export type ConversationSummaryHeaderProps = {
  conversation: ConversationSearchResult;
  modelCards?: Map<string, ModelCard>;
  tokenSummary?: TokenSummary | null;
  costSummary?: CostSummary | null;
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(6)}`;
  }
  if (usd < 1) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toLocaleString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  header: css({
    label: 'conversationSummaryHeader-header',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: theme.spacing(1.5, 2, 2),
    boxShadow: 'inset 0 8px 8px -8px rgba(0, 0, 0, 0.22)',
    flex: '0 0 auto',
  }),
  grid: css({
    label: 'conversationSummaryHeader-grid',
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  }),
  item: css({
    label: 'conversationSummaryHeader-item',
    minWidth: 0,
  }),
  label: css({
    label: 'conversationSummaryHeader-label',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
  }),
  value: css({
    label: 'conversationSummaryHeader-value',
    fontFamily: theme.typography.fontFamilyMonospace,
    overflowWrap: 'anywhere' as const,
  }),
  valueSecondary: css({
    label: 'conversationSummaryHeader-valueSecondary',
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(0.25),
    overflowWrap: 'anywhere' as const,
  }),
  tooltipTarget: css({
    label: 'conversationSummaryHeader-tooltipTarget',
    cursor: 'default',
    borderBottom: `1px dashed ${theme.colors.text.secondary}`,
    display: 'inline',
  }),
  modelChipsWrap: css({
    label: 'conversationSummaryHeader-modelChipsWrap',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
  modelChipAnchor: css({
    label: 'conversationSummaryHeader-modelChipAnchor',
    position: 'relative',
    display: 'inline-flex',
  }),
  modelChip: css({
    label: 'conversationSummaryHeader-modelChip',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0.75),
    borderRadius: '12px',
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    '&:hover': {
      borderColor: theme.colors.text.secondary,
      background: theme.colors.action.hover,
    },
  }),
  modelChipActive: css({
    label: 'conversationSummaryHeader-modelChipActive',
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  modelChipDot: css({
    label: 'conversationSummaryHeader-modelChipDot',
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  modelChipPlain: css({
    label: 'conversationSummaryHeader-modelChipPlain',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

export default function ConversationSummaryHeader({
  conversation,
  modelCards,
  tokenSummary,
  costSummary,
}: ConversationSummaryHeaderProps) {
  const styles = useStyles2(getStyles);
  const [openModel, setOpenModel] = useState<{ key: string; anchorRect: DOMRect } | null>(null);

  const modelNames = conversation.models;
  const hasModelCards = modelCards && modelCards.size > 0;
  const ratingSummary = conversation.rating_summary;
  const conversationTitle = conversation.conversation_title?.trim() ?? '';
  const hasConversationTitle = conversationTitle.length > 0;

  return (
    <div className={styles.header}>
      <div className={styles.grid}>
        <div className={styles.item}>
          <div className={styles.label}>{hasConversationTitle ? 'Conversation' : 'Conversation ID'}</div>
          <div className={styles.value}>{hasConversationTitle ? conversationTitle : conversation.conversation_id}</div>
          {hasConversationTitle && <div className={styles.valueSecondary}>{conversation.conversation_id}</div>}
        </div>
        <div className={styles.item}>
          <div className={styles.label}>LLM calls</div>
          <div>{conversation.generation_count}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>Models</div>
          {hasModelCards ? (
            <div className={styles.modelChipsWrap}>
              {Array.from(modelCards.entries()).map(([key, card]) => {
                const isOpen = openModel?.key === key;
                const chipLabel = stripProviderPrefix(card.name || card.source_model_id, card.provider);
                return (
                  <div key={key} className={styles.modelChipAnchor}>
                    <button
                      type="button"
                      className={`${styles.modelChip} ${isOpen ? styles.modelChipActive : ''}`}
                      onClick={(event) => {
                        if (isOpen) {
                          setOpenModel(null);
                          return;
                        }
                        setOpenModel({ key, anchorRect: event.currentTarget.getBoundingClientRect() });
                      }}
                      aria-label={`model card ${chipLabel}`}
                    >
                      <span className={styles.modelChipDot} style={{ background: getProviderColor(card.provider) }} />
                      <span>{chipLabel}</span>
                    </button>
                    {isOpen && (
                      <ModelCardPopover
                        card={card}
                        anchorRect={openModel?.anchorRect ?? null}
                        onClose={() => {
                          setOpenModel(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.modelChipPlain}>{modelNames.length > 0 ? modelNames.join(', ') : '-'}</div>
          )}
        </div>
        <div className={styles.item}>
          <div className={styles.label}>Errors</div>
          <div>{conversation.error_count}</div>
        </div>
        {tokenSummary && tokenSummary.totalTokens > 0 && (
          <div className={styles.item}>
            <div className={styles.label}>Tokens</div>
            <Tooltip
              content={
                <div>
                  <div>Input: {tokenSummary.inputTokens.toLocaleString()}</div>
                  <div>Output: {tokenSummary.outputTokens.toLocaleString()}</div>
                  {tokenSummary.cacheReadTokens > 0 && (
                    <div>Cache read: {tokenSummary.cacheReadTokens.toLocaleString()}</div>
                  )}
                  {tokenSummary.cacheWriteTokens > 0 && (
                    <div>Cache write: {tokenSummary.cacheWriteTokens.toLocaleString()}</div>
                  )}
                  {tokenSummary.reasoningTokens > 0 && (
                    <div>Reasoning: {tokenSummary.reasoningTokens.toLocaleString()}</div>
                  )}
                </div>
              }
              placement="bottom"
            >
              <div className={styles.tooltipTarget}>{formatTokenCount(tokenSummary.totalTokens)}</div>
            </Tooltip>
          </div>
        )}
        {costSummary && costSummary.totalCost > 0 && (
          <div className={styles.item}>
            <div className={styles.label}>Estimated Cost</div>
            <Tooltip
              content={
                <div>
                  <div>Input: {formatCost(costSummary.inputCost)}</div>
                  <div>Output: {formatCost(costSummary.outputCost)}</div>
                  {costSummary.cacheReadCost > 0 && <div>Cache read: {formatCost(costSummary.cacheReadCost)}</div>}
                  {costSummary.cacheWriteCost > 0 && <div>Cache write: {formatCost(costSummary.cacheWriteCost)}</div>}
                </div>
              }
              placement="bottom"
            >
              <div className={styles.tooltipTarget}>{formatCost(costSummary.totalCost)}</div>
            </Tooltip>
          </div>
        )}
        <div className={styles.item}>
          <div className={styles.label}>Ratings</div>
          <div>{ratingSummary ? `${ratingSummary.good_count} good / ${ratingSummary.bad_count} bad` : '-'}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>First generation</div>
          <div>{formatTimestamp(conversation.first_generation_at)}</div>
        </div>
        <div className={styles.item}>
          <div className={styles.label}>Last generation</div>
          <div>{formatTimestamp(conversation.last_generation_at)}</div>
        </div>
      </div>
    </div>
  );
}
