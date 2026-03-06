import React, { useEffect, useMemo, useState } from 'react';
import { cx } from '@emotion/css';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import type { CostSummary, TokenSummary } from '../../conversation/aggregates';
import type { ModelCard } from '../../modelcard/types';
import ModelCardPopover from '../conversations/ModelCardPopover';
import { getProviderColor, stripProviderPrefix, toDisplayProvider } from '../conversations/providerMeta';
import { withAlpha } from '../conversations/jaegerTree/serviceColors';
import { getStyles } from './MetricsBar.styles';

const TYPEWRITER_STEP_MS = 28;

export type MetricsBarProps = {
  conversationID: string;
  conversationTitle?: string;
  conversationUserId?: string;
  totalDurationMs: number;
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  callsByAgent?: Array<{ agent: string; count: number }>;
  models: string[];
  modelProviders?: Record<string, string>;
  modelCards?: Map<string, ModelCard>;
  errorCount: number;
  generationCount: number;
  isSaved?: boolean;
  onToggleSave?: () => void;
  onBack?: () => void;
};

type ConversationLabelProps = {
  label: string;
  animate: boolean;
  className: string;
  cursorClassName: string;
};

function ConversationLabel({ label, animate, className, cursorClassName }: ConversationLabelProps) {
  const [typedLabel, setTypedLabel] = useState(() => (animate ? '' : label));

  useEffect(() => {
    if (!animate || label.length === 0) {
      return;
    }

    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setTypedLabel(label.slice(0, index));
      if (index >= label.length) {
        window.clearInterval(interval);
      }
    }, TYPEWRITER_STEP_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [animate, label]);

  const visibleLabel = animate ? typedLabel : label;
  const showCursor = animate && typedLabel.length < label.length;

  return (
    <span className={className}>
      {visibleLabel}
      {showCursor && <span className={cursorClassName}>|</span>}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

function toAlphaHex(alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return Math.round(clampedAlpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

function findModelCard(
  modelCards: Map<string, ModelCard> | undefined,
  modelName: string,
  provider: string,
  displayProvider: string
): ModelCard | null {
  if (!modelCards || modelCards.size === 0) {
    return null;
  }

  const exactProviderKey = `${provider}::${modelName}`;
  const exactDisplayProviderKey = `${displayProvider}::${modelName}`;
  if (modelCards.has(exactProviderKey)) {
    return modelCards.get(exactProviderKey) ?? null;
  }
  if (modelCards.has(exactDisplayProviderKey)) {
    return modelCards.get(exactDisplayProviderKey) ?? null;
  }

  for (const [key, card] of modelCards.entries()) {
    if (key.endsWith(`::${modelName}`)) {
      return card;
    }
  }
  return null;
}

function getStatusTooltip(errorCount: number): string {
  if (errorCount > 0) {
    return `${errorCount} generation${errorCount === 1 ? '' : 's'} in this conversation ${
      errorCount === 1 ? 'has' : 'have'
    } an error message.`;
  }
  return 'No generations in this conversation have an error message.';
}

function renderBreakdownTable(rows: Array<{ label: string; value: string }>): React.JSX.Element {
  return (
    <table style={{ borderCollapse: 'separate', borderSpacing: '0 0' }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th align="left" style={{ paddingRight: 24, whiteSpace: 'nowrap' }}>
              {row.label}
            </th>
            <td align="right" style={{ minWidth: 72, whiteSpace: 'nowrap' }}>
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function getTokenTooltip(tokenSummary: TokenSummary): React.JSX.Element {
  return renderBreakdownTable([
    { label: 'Input', value: formatTokenCount(tokenSummary.inputTokens) },
    { label: 'Output', value: formatTokenCount(tokenSummary.outputTokens) },
    { label: 'Cache read', value: formatTokenCount(tokenSummary.cacheReadTokens) },
    { label: 'Cache write', value: formatTokenCount(tokenSummary.cacheWriteTokens) },
    { label: 'Total', value: formatTokenCount(tokenSummary.totalTokens) },
  ]);
}

function getCallsTooltip(callsByAgent: Array<{ agent: string; count: number }>): React.JSX.Element | string {
  if (callsByAgent.length === 0) {
    return 'No agent names found for these calls.';
  }

  return renderBreakdownTable(
    callsByAgent.map(({ agent, count }) => ({
      label: agent,
      value: String(count),
    }))
  );
}

function getCostTooltip(costSummary: CostSummary): React.JSX.Element {
  return renderBreakdownTable([
    { label: 'Input', value: formatCost(costSummary.inputCost) },
    { label: 'Output', value: formatCost(costSummary.outputCost) },
    { label: 'Cache read', value: formatCost(costSummary.cacheReadCost) },
    { label: 'Cache write', value: formatCost(costSummary.cacheWriteCost) },
    { label: 'Total', value: formatCost(costSummary.totalCost) },
  ]);
}

export default function MetricsBar({
  conversationID,
  conversationTitle,
  conversationUserId,
  totalDurationMs,
  tokenSummary,
  costSummary,
  callsByAgent = [],
  models,
  modelProviders,
  modelCards,
  errorCount,
  generationCount,
  isSaved = false,
  onToggleSave,
  onBack,
}: MetricsBarProps) {
  const styles = useStyles2(getStyles);
  const [openModel, setOpenModel] = useState<{ key: string; anchorRect: DOMRect } | null>(null);
  const statusTooltip = getStatusTooltip(errorCount);
  const normalizedConversationTitle = conversationTitle?.trim() ?? '';
  const conversationLabel = normalizedConversationTitle.length > 0 ? normalizedConversationTitle : conversationID;
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animateConversationLabel = normalizedConversationTitle.length > 0 && !prefersReducedMotion;

  const uniqueModels = useMemo(() => Array.from(new Set(models)), [models]);
  const modelMeta = useMemo(
    () =>
      uniqueModels.map((model) => {
        const provider = modelProviders?.[model]?.trim() ?? '';
        const displayProvider = toDisplayProvider(provider);
        const card = findModelCard(modelCards, model, provider, displayProvider);
        const color = getProviderColor(displayProvider);
        const displayName = provider ? stripProviderPrefix(model, displayProvider) : model;
        const key = `${provider || 'unknown'}::${model}`;
        return {
          key,
          displayName,
          color,
          card,
        };
      }),
    [modelCards, modelProviders, uniqueModels]
  );
  const activeModelCard = useMemo(() => {
    if (!openModel) {
      return null;
    }
    return modelMeta.find(({ key }) => key === openModel.key)?.card ?? null;
  }, [modelMeta, openModel]);

  return (
    <div className={styles.container}>
      {onBack && (
        <Tooltip content="Back" placement="bottom">
          <button type="button" className={styles.backButton} onClick={onBack} aria-label="Go back">
            <Icon name="arrow-left" size="md" />
          </button>
        </Tooltip>
      )}
      <div className={styles.titleBlock}>
        <Tooltip content={conversationLabel} placement="bottom">
          <ConversationLabel
            key={conversationLabel}
            label={conversationLabel}
            animate={animateConversationLabel}
            className={cx(styles.conversationId, animateConversationLabel && styles.conversationTitle)}
            cursorClassName={styles.typewriterCursor}
          />
        </Tooltip>
        {conversationUserId?.trim() && (
          <ConversationLabel
            key={conversationUserId.trim()}
            label={conversationUserId.trim()}
            animate={animateConversationLabel}
            className={styles.titleMeta}
            cursorClassName={styles.titleMetaCursor}
          />
        )}
      </div>

      <div className={styles.separator} />

      <div className={styles.metric}>
        <Icon name="clock-nine" size="sm" />
        <span className={styles.metricValue}>{formatDuration(totalDurationMs)}</span>
      </div>

      <div className={styles.separator} />

      <Tooltip content={getCallsTooltip(callsByAgent)} placement="bottom">
        <div className={styles.metric}>
          <Icon name="exchange-alt" size="sm" />
          <span className={styles.metricValue}>{generationCount}</span>
          <span>{generationCount === 1 ? 'call' : 'calls'}</span>
        </div>
      </Tooltip>

      {tokenSummary && tokenSummary.totalTokens > 0 && (
        <>
          <div className={styles.separator} />
          <Tooltip content={getTokenTooltip(tokenSummary)} placement="bottom">
            <div className={styles.metric}>
              <Icon name="document-info" size="sm" />
              <span className={styles.metricValue}>{formatTokenCount(tokenSummary.totalTokens)}</span>
              <span>tokens</span>
            </div>
          </Tooltip>
        </>
      )}

      {costSummary && costSummary.totalCost > 0 && (
        <>
          <div className={styles.separator} />
          <Tooltip content={getCostTooltip(costSummary)} placement="bottom">
            <div className={styles.metric}>
              <span className={styles.metricValue}>{formatCost(costSummary.totalCost)}</span>
              <span>cost</span>
            </div>
          </Tooltip>
        </>
      )}

      <div className={styles.separator} />

      <Tooltip content={statusTooltip} placement="bottom">
        {errorCount > 0 ? (
          <span className={`${styles.statusBadge} ${styles.statusError}`}>
            <Icon name="exclamation-circle" size="sm" />
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        ) : (
          <span className={`${styles.statusBadge} ${styles.statusSuccess}`}>
            <Icon name="check-circle" size="sm" />
            OK
          </span>
        )}
      </Tooltip>

      {onToggleSave && (
        <Tooltip content={isSaved ? 'Unsave conversation' : 'Save conversation'} placement="bottom">
          <button
            type="button"
            className={cx(styles.saveButton, isSaved && styles.saveButtonActive)}
            onClick={onToggleSave}
            aria-label={isSaved ? 'unsave conversation' : 'save conversation'}
          >
            <Icon name={isSaved ? 'favorite' : 'star'} size="md" />
          </button>
        </Tooltip>
      )}

      <div className={styles.modelChips}>
        {modelMeta.map(({ key, displayName, color, card }) => {
          const isOpen = openModel?.key === key;
          const chipToneStyle = {
            '--chip-border-color': withAlpha(color, toAlphaHex(isOpen ? 0.7 : 0.38)),
            '--chip-bg': withAlpha(color, toAlphaHex(isOpen ? 0.2 : 0.1)),
          } as React.CSSProperties;

          return (
            <span key={key} className={styles.modelChipAnchor}>
              <button
                type="button"
                className={cx(styles.modelChip, styles.modelChipButton, isOpen && styles.modelChipActive)}
                style={chipToneStyle}
                onClick={(event) => {
                  if (!card) {
                    return;
                  }
                  if (isOpen) {
                    setOpenModel(null);
                    return;
                  }
                  setOpenModel({ key, anchorRect: event.currentTarget.getBoundingClientRect() });
                }}
                aria-label={card ? `model card ${displayName}` : `model ${displayName}`}
                disabled={!card}
              >
                <span className={styles.providerDot} style={{ background: color }} />
                {displayName}
              </button>
            </span>
          );
        })}
      </div>

      {openModel && activeModelCard && (
        <ModelCardPopover card={activeModelCard} anchorRect={openModel.anchorRect} onClose={() => setOpenModel(null)} />
      )}
    </div>
  );
}
