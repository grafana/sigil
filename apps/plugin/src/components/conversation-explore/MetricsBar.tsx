import React from 'react';
import { cx } from '@emotion/css';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import type { CostSummary, TokenSummary } from '../../conversation/aggregates';
import { getProviderColor, stripProviderPrefix, toDisplayProvider } from '../conversations/providerMeta';
import { getStyles } from './MetricsBar.styles';

export type MetricsBarProps = {
  conversationID: string;
  totalDurationMs: number;
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  models: string[];
  modelProviders?: Record<string, string>;
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

export default function MetricsBar({
  conversationID,
  totalDurationMs,
  tokenSummary,
  costSummary,
  models,
  modelProviders,
  errorCount,
  generationCount,
  isSaved = false,
  onToggleSave,
}: MetricsBarProps) {
  const styles = useStyles2(getStyles);

  const uniqueModels = Array.from(new Set(models));

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
        {uniqueModels.map((model) => {
          const provider = modelProviders?.[model] ?? '';
          const displayProvider = toDisplayProvider(provider);
          const color = getProviderColor(displayProvider);
          const displayName = provider ? stripProviderPrefix(model, displayProvider) : model;

          return (
            <span key={model} className={styles.modelChip}>
              <span className={styles.providerDot} style={{ background: color }} />
              {displayName}
            </span>
          );
        })}
      </div>
    </div>
  );
}
