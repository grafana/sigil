import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { ModelCard } from '../../modelcard/types';
import type { ConversationData, ConversationSpan, ConversationSearchResult } from '../../conversation/types';
import type { TokenSummary, CostSummary } from '../../conversation/aggregates';
import ConversationGenerations from './ConversationGenerations';
import ModelCardPopover from './ModelCardPopover';
import { getProviderColor, stripProviderPrefix } from './providerMeta';

export type ConversationColumnProps = {
  conversation: ConversationSearchResult;
  data: ConversationData | null;
  modelCards?: Map<string, ModelCard>;
  tokenSummary?: TokenSummary | null;
  costSummary?: CostSummary | null;
  loading?: boolean;
  errorMessage?: string;
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: ConversationSpan | null) => void;
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

const emptyConversationData: ConversationData = {
  conversationID: '',
  generationCount: 0,
  firstGenerationAt: '',
  lastGenerationAt: '',
  ratingSummary: null,
  annotations: [],
  spans: [],
  orphanGenerations: [],
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'conversationColumn-container',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    height: '100%',
    overflowY: 'auto' as const,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    padding: theme.spacing(0, 0.5, 0, 2),
  }),
  summary: css({
    label: 'conversationColumn-summary',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    padding: theme.spacing(1.5, 0.75, 2),
    margin: theme.spacing(0.5, 0, 2.5),
  }),
  summaryGrid: css({
    label: 'conversationColumn-summaryGrid',
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  }),
  summaryItem: css({
    label: 'conversationColumn-summaryItem',
    minWidth: 0,
  }),
  summaryLabel: css({
    label: 'conversationColumn-summaryLabel',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
  }),
  summaryValue: css({
    label: 'conversationColumn-summaryValue',
    fontFamily: theme.typography.fontFamilyMonospace,
    overflowWrap: 'anywhere' as const,
  }),
  tooltipTarget: css({
    label: 'conversationColumn-tooltipTarget',
    cursor: 'default',
    borderBottom: `1px dashed ${theme.colors.text.secondary}`,
    display: 'inline',
  }),
  modelChipsWrap: css({
    label: 'conversationColumn-modelChipsWrap',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
  modelChipAnchor: css({
    label: 'conversationColumn-modelChipAnchor',
    position: 'relative',
    display: 'inline-flex',
  }),
  modelChip: css({
    label: 'conversationColumn-modelChip',
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
    label: 'conversationColumn-modelChipActive',
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  modelChipDot: css({
    label: 'conversationColumn-modelChipDot',
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  modelChipPlain: css({
    label: 'conversationColumn-modelChipPlain',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

export default function ConversationColumn({
  conversation,
  data,
  modelCards,
  tokenSummary,
  costSummary,
  loading = false,
  errorMessage = '',
  selectedSpanSelectionID = '',
  onSelectSpan,
}: ConversationColumnProps) {
  const styles = useStyles2(getStyles);
  const ratingSummary = conversation.rating_summary;
  const [openModel, setOpenModel] = useState<{ key: string; anchorRect: DOMRect } | null>(null);

  const modelNames = conversation.models;
  const hasModelCards = modelCards && modelCards.size > 0;

  return (
    <div className={styles.container}>
      <div className={styles.summary}>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Conversation ID</div>
            <div className={styles.summaryValue}>{conversation.conversation_id}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>LLM calls</div>
            <div>{conversation.generation_count}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Models</div>
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
              <div>{modelNames.length > 0 ? modelNames.join(', ') : '-'}</div>
            )}
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Errors</div>
            <div>{conversation.error_count}</div>
          </div>
          {tokenSummary && tokenSummary.totalTokens > 0 && (
            <div className={styles.summaryItem}>
              <div className={styles.summaryLabel}>Tokens</div>
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
            <div className={styles.summaryItem}>
              <div className={styles.summaryLabel}>Estimated Cost</div>
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
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Ratings</div>
            <div>{ratingSummary ? `${ratingSummary.good_count} good / ${ratingSummary.bad_count} bad` : '-'}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>First generation</div>
            <div>{formatTimestamp(conversation.first_generation_at)}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Last generation</div>
            <div>{formatTimestamp(conversation.last_generation_at)}</div>
          </div>
        </div>
      </div>
      <ConversationGenerations
        data={data ?? emptyConversationData}
        loading={loading}
        errorMessage={errorMessage}
        selectedSpanSelectionID={selectedSpanSelectionID}
        onSelectSpan={onSelectSpan}
      />
    </div>
  );
}
