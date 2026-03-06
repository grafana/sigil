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
  totalDurationMs: number;
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  models: string[];
  modelProviders?: Record<string, string>;
  modelCards?: Map<string, ModelCard>;
  errorCount: number;
  generationCount: number;
  isSaved?: boolean;
  onToggleSave?: () => void;
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

export default function MetricsBar({
  conversationID,
  conversationTitle,
  totalDurationMs,
  tokenSummary,
  costSummary,
  models,
  modelProviders,
  modelCards,
  errorCount,
  generationCount,
  isSaved = false,
  onToggleSave,
}: MetricsBarProps) {
  const styles = useStyles2(getStyles);
  const [openModel, setOpenModel] = useState<{ key: string; anchorRect: DOMRect } | null>(null);
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
      <Tooltip content={conversationLabel} placement="bottom">
        <ConversationLabel
          key={conversationLabel}
          label={conversationLabel}
          animate={animateConversationLabel}
          className={cx(styles.conversationId, animateConversationLabel && styles.conversationTitle)}
          cursorClassName={styles.typewriterCursor}
        />
      </Tooltip>

      <div className={styles.separator} />

      <div className={styles.metric}>
        <Icon name="clock-nine" size="sm" />
        <span className={styles.metricValue}>{formatDuration(totalDurationMs)}</span>
      </div>

      <div className={styles.separator} />

      <div className={styles.metric}>
        <Icon name="exchange-alt" size="sm" />
        <span className={styles.metricValue}>{generationCount}</span>
        <span>{generationCount === 1 ? 'call' : 'calls'}</span>
      </div>

      {tokenSummary && tokenSummary.totalTokens > 0 && (
        <>
          <div className={styles.separator} />
          <Tooltip
            content={`In: ${formatTokenCount(tokenSummary.inputTokens)} · Out: ${formatTokenCount(tokenSummary.outputTokens)}${
              tokenSummary.cacheReadTokens > 0 || tokenSummary.cacheWriteTokens > 0
                ? ` · Cache read: ${formatTokenCount(tokenSummary.cacheReadTokens)} · Cache write: ${formatTokenCount(tokenSummary.cacheWriteTokens)}`
                : ''
            }`}
            placement="bottom"
          >
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
          <div className={styles.metric}>
            <span className={styles.metricValue}>{formatCost(costSummary.totalCost)}</span>
          </div>
        </>
      )}

      <div className={styles.separator} />

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
