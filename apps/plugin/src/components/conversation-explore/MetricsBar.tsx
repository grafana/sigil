import React, { useMemo, useState } from 'react';
import { cx } from '@emotion/css';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import type { CostSummary, TokenSummary } from '../../conversation/aggregates';
import type { ModelCard } from '../../modelcard/types';
import ModelCardPopover from '../conversations/ModelCardPopover';
import { getProviderColor, stripProviderPrefix, toDisplayProvider } from '../conversations/providerMeta';
import { getStyles } from './MetricsBar.styles';

export type MetricsBarProps = {
  conversationID: string;
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

function withAlpha(color: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const hex = color.trim();

  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(hex);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('').map((part) => parseInt(part + part, 16));
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
  }

  const fullMatch = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (fullMatch) {
    const value = fullMatch[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
  }

  return color;
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

  const uniqueModels = Array.from(new Set(models));
  const modelMeta = useMemo(
    () =>
      uniqueModels.map((model) => {
        const provider = modelProviders?.[model] ?? '';
        const displayProvider = toDisplayProvider(provider);
        const card = findModelCard(modelCards, model, provider, displayProvider);
        const color = getProviderColor(displayProvider);
        const displayName = provider ? stripProviderPrefix(model, displayProvider) : model;
        const key = `${provider}::${model}`;
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
      <Tooltip content={conversationID} placement="bottom">
        <span className={styles.conversationId}>{conversationID}</span>
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
            content={`In: ${formatTokenCount(tokenSummary.inputTokens)} · Out: ${formatTokenCount(tokenSummary.outputTokens)}${tokenSummary.cacheReadTokens > 0 ? ` · Cache: ${formatTokenCount(tokenSummary.cacheReadTokens)}` : ''}`}
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
          const chipToneStyle: React.CSSProperties = {
            borderColor: withAlpha(color, isOpen ? 0.7 : 0.38),
            background: withAlpha(color, isOpen ? 0.2 : 0.1),
          };
          if (!card) {
            return (
              <span key={key} className={styles.modelChip} style={chipToneStyle}>
                <span className={styles.providerDot} style={{ background: color }} />
                {displayName}
              </span>
            );
          }

          return (
            <button
              key={key}
              type="button"
              className={cx(styles.modelChip, styles.modelChipButton, isOpen && styles.modelChipActive)}
              style={chipToneStyle}
              onClick={(event) => {
                if (isOpen) {
                  setOpenModel(null);
                  return;
                }
                setOpenModel({ key, anchorRect: event.currentTarget.getBoundingClientRect() });
              }}
              aria-label={`model card ${displayName}`}
            >
              <span className={styles.providerDot} style={{ background: color }} />
              {displayName}
            </button>
          );
        })}
      </div>

      {openModel && activeModelCard && (
        <ModelCardPopover card={activeModelCard} anchorRect={openModel.anchorRect} onClose={() => setOpenModel(null)} />
      )}
    </div>
  );
}
