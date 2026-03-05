import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Spinner, Text, useStyles2, useTheme2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../../agents/api';
import type { AgentRatingResponse, AgentRatingStatus, AgentRatingSuggestion } from '../../agents/types';

export type AgentRatingPanelProps = {
  agentName: string;
  version?: string;
  dataSource?: AgentsDataSource;
  initialResult?: AgentRatingResponse | null;
  initialLoading?: boolean;
  initialError?: string;
};

const severityOrder = ['high', 'medium', 'low'] as const;
const ratingPollingIntervalMs = 5000;

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    overflow: 'hidden',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
  }),
  empty: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  loading: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  scoreRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  scorePill: css({
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.5),
    borderRadius: theme.shape.radius.pill,
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    border: `1px solid ${theme.colors.border.medium}`,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  scoreValue: css({
    fontSize: theme.typography.h3.fontSize,
    lineHeight: 1.1,
    fontVariantNumeric: 'tabular-nums',
  }),
  scoreDenominator: css({
    color: theme.colors.text.secondary,
  }),
  summary: css({
    color: theme.colors.text.secondary,
    lineHeight: 1.5,
  }),
  suggestionGroup: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
  }),
  suggestionGroupHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  suggestionCard: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  suggestionMetaRow: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  suggestionCategory: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  }),
  suggestionDescription: css({
    color: theme.colors.text.secondary,
    lineHeight: 1.45,
  }),
});

function scoreTone(theme: GrafanaTheme2, score: number): string {
  if (score >= 9) {
    return theme.colors.success.text;
  }
  if (score >= 7) {
    return theme.colors.info.text;
  }
  if (score >= 5) {
    return theme.colors.warning.text;
  }
  return theme.colors.error.text;
}

function normalizeSeverity(rawSeverity: string): 'high' | 'medium' | 'low' {
  const normalized = rawSeverity.trim().toLowerCase();
  if (normalized === 'high') {
    return 'high';
  }
  if (normalized === 'medium') {
    return 'medium';
  }
  return 'low';
}

function groupSuggestionsBySeverity(
  suggestions: AgentRatingSuggestion[]
): Record<'high' | 'medium' | 'low', AgentRatingSuggestion[]> {
  const groups: Record<'high' | 'medium' | 'low', AgentRatingSuggestion[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const suggestion of suggestions) {
    groups[normalizeSeverity(suggestion.severity)].push(suggestion);
  }
  return groups;
}

function severityBadgeColor(severity: 'high' | 'medium' | 'low'): 'red' | 'orange' | 'blue' {
  if (severity === 'high') {
    return 'red';
  }
  if (severity === 'medium') {
    return 'orange';
  }
  return 'blue';
}

function normalizeRatingStatus(status: AgentRatingStatus | string | undefined): AgentRatingStatus {
  const normalized = (status ?? '').trim().toLowerCase();
  if (normalized === 'pending') {
    return 'pending';
  }
  if (normalized === 'failed') {
    return 'failed';
  }
  return 'completed';
}

export default function AgentRatingPanel({
  agentName,
  version,
  dataSource = defaultAgentsDataSource,
  initialResult = null,
  initialLoading = false,
  initialError = '',
}: AgentRatingPanelProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [running, setRunning] = useState<boolean>(
    initialLoading || (initialResult !== null && normalizeRatingStatus(initialResult.status) === 'pending')
  );
  const [result, setResult] = useState<AgentRatingResponse | null>(initialResult);
  const [error, setError] = useState<string>(initialError);
  const requestIdRef = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollInFlightRef.current = false;
  }, []);

  const startPolling = useCallback(
    (requestId: number) => {
      stopPolling();
      const resolvedVersion = version && version.length > 0 ? version : undefined;

      const poll = async () => {
        if (pollInFlightRef.current) {
          return;
        }
        pollInFlightRef.current = true;
        try {
          const rating = await dataSource.lookupAgentRating(agentName, resolvedVersion);
          if (requestIdRef.current !== requestId) {
            return;
          }
          if (rating === null) {
            setRunning(true);
            return;
          }
          const status = normalizeRatingStatus(rating.status);
          if (status === 'pending') {
            setRunning(true);
            return;
          }
          stopPolling();
          if (status === 'failed') {
            setResult(null);
            setRunning(false);
            setError('Agent rating failed. Please try again.');
            return;
          }
          setResult(rating);
          setRunning(false);
          setError('');
        } catch (err: unknown) {
          if (requestIdRef.current !== requestId) {
            return;
          }
          stopPolling();
          setResult(null);
          setRunning(false);
          setError(err instanceof Error ? err.message : 'Failed to load latest agent rating');
        } finally {
          pollInFlightRef.current = false;
        }
      };

      void poll();
      pollIntervalRef.current = setInterval(() => {
        void poll();
      }, ratingPollingIntervalMs);
    },
    [agentName, dataSource, stopPolling, version]
  );

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    stopPolling();

    const initialStatus = initialResult !== null ? normalizeRatingStatus(initialResult.status) : null;
    setRunning(initialLoading || initialStatus === 'pending');
    setResult(initialResult);
    setError(initialError);
    if (initialStatus === 'pending') {
      startPolling(requestId);
    }
    return () => {
      stopPolling();
    };
  }, [agentName, initialError, initialLoading, initialResult, startPolling, stopPolling, version]);

  const completedResult = useMemo(() => {
    if (result === null) {
      return null;
    }
    if (normalizeRatingStatus(result.status) !== 'completed') {
      return null;
    }
    return result;
  }, [result]);

  const groupedSuggestions = useMemo(() => {
    if (!completedResult) {
      return {
        high: [],
        medium: [],
        low: [],
      };
    }
    return groupSuggestionsBySeverity(completedResult.suggestions ?? []);
  }, [completedResult]);

  const runRating = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    stopPolling();
    setRunning(true);
    setError('');
    setResult(null);

    try {
      const resolvedVersion = version && version.length > 0 ? version : undefined;
      const rating = await dataSource.rateAgent(agentName, resolvedVersion);
      if (requestIdRef.current !== requestId) {
        return;
      }
      const status = normalizeRatingStatus(rating.status);
      if (status === 'pending') {
        setRunning(true);
        startPolling(requestId);
        return;
      }
      if (status === 'failed') {
        setRunning(false);
        setResult(null);
        setError('Agent rating failed. Please try again.');
        return;
      }
      setResult(rating);
      setRunning(false);
    } catch (err: unknown) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setRunning(false);
      setResult(null);
      setError(err instanceof Error ? err.message : 'Failed to evaluate agent');
    }
  }, [agentName, dataSource, startPolling, stopPolling, version]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Text weight="medium">Agent Rating</Text>
        {completedResult && (
          <Badge
            text={`${completedResult.score}/10`}
            color={
              completedResult.score >= 9
                ? 'green'
                : completedResult.score >= 7
                  ? 'blue'
                  : completedResult.score >= 5
                    ? 'orange'
                    : 'red'
            }
          />
        )}
      </div>
      <div className={styles.body}>
        {running && (
          <div className={styles.loading}>
            <Spinner size={16} />
            <Text variant="bodySmall" color="secondary">
              Evaluating...
            </Text>
          </div>
        )}

        {error.length > 0 && (
          <Alert severity="error" title="Agent rating failed">
            {error}
          </Alert>
        )}

        {!running && !completedResult && (
          <div className={styles.empty}>
            <Text variant="bodySmall" color="secondary">
              Run an on-demand evaluation of this agent&apos;s prompt, tools, and token budget.
            </Text>
            <div>
              <Button onClick={() => void runRating()} icon="play" variant="primary">
                Rate this agent
              </Button>
            </div>
          </div>
        )}

        {!running && completedResult && (
          <>
            <div className={styles.scoreRow}>
              <div className={styles.scorePill}>
                <span className={styles.scoreValue} style={{ color: scoreTone(theme, completedResult.score) }}>
                  {completedResult.score}
                </span>
                <span className={styles.scoreDenominator}>/ 10</span>
              </div>
              <Text variant="bodySmall" color="secondary">
                Evaluated by {completedResult.judge_model} in {completedResult.judge_latency_ms}ms
              </Text>
            </div>

            <div className={styles.summary}>{completedResult.summary}</div>

            {completedResult.token_warning && completedResult.token_warning.length > 0 && (
              <Alert severity="warning" title="Token budget warning">
                {completedResult.token_warning}
              </Alert>
            )}

            {severityOrder.map((severity) => {
              const suggestions = groupedSuggestions[severity];
              if (suggestions.length === 0) {
                return null;
              }
              return (
                <div key={severity} className={styles.suggestionGroup}>
                  <div className={styles.suggestionGroupHeader}>
                    <Badge text={severity.toUpperCase()} color={severityBadgeColor(severity)} />
                    <Text variant="bodySmall" color="secondary">
                      {suggestions.length} suggestion{suggestions.length > 1 ? 's' : ''}
                    </Text>
                  </div>
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={`${severity}-${index}-${suggestion.category}-${suggestion.title}`}
                      className={styles.suggestionCard}
                    >
                      <div className={styles.suggestionMetaRow}>
                        <Text weight="medium">{suggestion.title}</Text>
                        <span className={styles.suggestionCategory}>{suggestion.category}</span>
                      </div>
                      <div className={styles.suggestionDescription}>{suggestion.description}</div>
                    </div>
                  ))}
                </div>
              );
            })}

            <div>
              <Button onClick={() => void runRating()} icon="sync" variant="secondary">
                Re-run
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
