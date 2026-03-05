import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Text, useStyles2, useTheme2 } from '@grafana/ui';
import { useAssistant } from '@grafana/assistant';
import { useSearchParams } from 'react-router-dom';
import { defaultAgentsDataSource, type AgentsDataSource } from '../../agents/api';
import type { AgentRatingResponse, AgentRatingStatus, AgentRatingSuggestion } from '../../agents/types';
import { Loader } from '../Loader';

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
const SUMMARY_MAX_CHARS = 160;
const SUGGESTION_MAX_CHARS = 110;
const MAX_SUGGESTIONS_TOTAL = 10;
const SUGGESTION_QUERY_PARAM = 'suggestion';
const RATING_LOADER_LINES = [
  'Inspecting system prompt structure...',
  'Reviewing tool schema clarity...',
  'Checking prompt-tool alignment...',
  'Scoring context efficiency and token budget...',
  'Analyzing instruction quality and constraints...',
  'Drafting targeted optimization suggestions...',
];

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
  emptyList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    color: theme.colors.text.secondary,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  emptyListItem: css({
    lineHeight: 1.45,
  }),
  actionArea: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: theme.spacing(0.75),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
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
    padding: theme.spacing(0.25, 0),
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
  suggestionTitleRow: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  suggestionTitleButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left' as const,
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
  suggestionSeverityDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
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
  suggestionDescriptionRow: css({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(0.5),
  }),
  suggestionDescriptionText: css({
    flex: 1,
    minWidth: 0,
  }),
  menuWrap: css({
    position: 'relative' as const,
    display: 'inline-flex',
    flexShrink: 0,
  }),
  menuButton: css({
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.disabled,
    cursor: 'pointer',
    padding: `${theme.spacing(0.125)} ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    lineHeight: 1,
    fontWeight: theme.typography.fontWeightBold,
    '&:hover': {
      background: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  menuPanel: css({
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: 140,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z3,
    padding: theme.spacing(0.5),
    zIndex: 2,
  }),
  menuItem: css({
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.primary,
    textAlign: 'left' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    borderRadius: theme.shape.radius.default,
    padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  actionNote: css({
    margin: 0,
  }),
  modalBackdrop: css({
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(2),
    zIndex: 1000,
  }),
  modal: css({
    width: 'min(720px, 100%)',
    maxHeight: '85vh',
    overflow: 'auto',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z3,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  modalHeader: css({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  }),
  modalTitleRow: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
  modalCloseButton: css({
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    padding: theme.spacing(0.5),
    borderRadius: theme.shape.radius.default,
    lineHeight: 1,
    '&:hover': {
      background: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  modalBody: css({
    color: theme.colors.text.secondary,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
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

function severityDotColor(theme: GrafanaTheme2, severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') {
    return theme.colors.error.text;
  }
  if (severity === 'medium') {
    return theme.colors.warning.text;
  }
  return theme.colors.info.text;
}

function severityRank(severity: 'high' | 'medium' | 'low'): number {
  if (severity === 'high') {
    return 0;
  }
  if (severity === 'medium') {
    return 1;
  }
  return 2;
}

function toSuccinctText(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  const sentenceEnd = compact.search(/[.!?](\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= maxChars) {
    return compact.slice(0, sentenceEnd + 1);
  }

  return `${compact.slice(0, maxChars - 3).trimEnd()}...`;
}

function toSuggestionKey(suggestion: AgentRatingSuggestion): string {
  return [
    normalizeSeverity(suggestion.severity),
    suggestion.category.trim().toLowerCase(),
    suggestion.title.trim().toLowerCase(),
    suggestion.description.trim().toLowerCase(),
  ].join('|');
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

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const withStatus = err as {
    status?: unknown;
    statusCode?: unknown;
    data?: { status?: unknown; statusCode?: unknown; message?: unknown };
    message?: unknown;
  };
  if (withStatus.status === 404 || withStatus.statusCode === 404) {
    return true;
  }
  if (withStatus.data?.status === 404 || withStatus.data?.statusCode === 404) {
    return true;
  }
  const message = typeof withStatus.message === 'string' ? withStatus.message : '';
  const dataMessage = typeof withStatus.data?.message === 'string' ? withStatus.data.message : '';
  return /\b404\b/.test(message) || /\b404\b/.test(dataMessage);
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
  const assistant = useAssistant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [running, setRunning] = useState<boolean>(
    initialLoading || (initialResult !== null && normalizeRatingStatus(initialResult.status) === 'pending')
  );
  const [result, setResult] = useState<AgentRatingResponse | null>(initialResult);
  const [error, setError] = useState<string>(initialError);
  const [openMenuSuggestionKey, setOpenMenuSuggestionKey] = useState<string | null>(null);
  const [rejectedSuggestionKeys, setRejectedSuggestionKeys] = useState<Record<string, true>>({});
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
          if (isNotFoundError(err)) {
            stopPolling();
            setResult(null);
            setRunning(false);
            setError('');
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

  useEffect(() => {
    if (!openMenuSuggestionKey) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const scopedParent = event.target.closest('[data-suggestion-menu-scope]');
      if (!(scopedParent instanceof HTMLElement)) {
        setOpenMenuSuggestionKey(null);
        return;
      }
      if (scopedParent.dataset.suggestionMenuScope !== openMenuSuggestionKey) {
        setOpenMenuSuggestionKey(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [openMenuSuggestionKey]);

  const completedResult = useMemo(() => {
    if (result === null) {
      return null;
    }
    if (normalizeRatingStatus(result.status) !== 'completed') {
      return null;
    }
    return result;
  }, [result]);

  useEffect(() => {
    setOpenMenuSuggestionKey(null);
    setRejectedSuggestionKeys({});
  }, [completedResult]);

  const groupedSuggestions = useMemo(() => {
    if (!completedResult) {
      return {
        high: [],
        medium: [],
        low: [],
      };
    }
    const prioritized = [...(completedResult.suggestions ?? [])]
      .filter((suggestion) => !rejectedSuggestionKeys[toSuggestionKey(suggestion)])
      .sort((a, b) => severityRank(normalizeSeverity(a.severity)) - severityRank(normalizeSeverity(b.severity)))
      .slice(0, MAX_SUGGESTIONS_TOTAL);
    return groupSuggestionsBySeverity(prioritized);
  }, [completedResult, rejectedSuggestionKeys]);

  const suggestionByKey = useMemo(() => {
    const byKey = new Map<string, AgentRatingSuggestion>();
    for (const severity of severityOrder) {
      for (const suggestion of groupedSuggestions[severity]) {
        const key = toSuggestionKey(suggestion);
        if (!byKey.has(key)) {
          byKey.set(key, suggestion);
        }
      }
    }
    return byKey;
  }, [groupedSuggestions]);

  const selectedSuggestionKey = searchParams.get(SUGGESTION_QUERY_PARAM)?.trim() ?? '';
  const selectedSuggestion = selectedSuggestionKey.length > 0 ? suggestionByKey.get(selectedSuggestionKey) ?? null : null;

  const succinctSummary = useMemo(() => {
    if (!completedResult) {
      return '';
    }
    return toSuccinctText(completedResult.summary, SUMMARY_MAX_CHARS);
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

  const onExplainSuggestion = useCallback(
    (suggestion: AgentRatingSuggestion) => {
      const prompt = [
        'Explain this recommendation in concise, plain language and why it matters.',
        '',
        `Severity: ${normalizeSeverity(suggestion.severity)}`,
        `Category: ${suggestion.category}`,
        `Title: ${suggestion.title}`,
        `Description: ${suggestion.description}`,
      ].join('\n');
      if (!assistant.openAssistant) {
        window.location.href = buildAssistantUrl(prompt);
        return;
      }
      assistant.openAssistant({
        origin: 'sigil-agent-rating',
        prompt,
        autoSend: true,
      });
      setOpenMenuSuggestionKey(null);
    },
    [assistant]
  );

  const onRejectSuggestion = useCallback((suggestion: AgentRatingSuggestion) => {
    const key = toSuggestionKey(suggestion);
    setRejectedSuggestionKeys((prev) => ({ ...prev, [toSuggestionKey(suggestion)]: true }));
    if (selectedSuggestionKey === key) {
      const next = new URLSearchParams(searchParams);
      next.delete(SUGGESTION_QUERY_PARAM);
      setSearchParams(next, { replace: false });
    }
    setOpenMenuSuggestionKey(null);
  }, [searchParams, selectedSuggestionKey, setSearchParams]);

  const openSuggestionModal = useCallback(
    (suggestion: AgentRatingSuggestion) => {
      const next = new URLSearchParams(searchParams);
      next.set(SUGGESTION_QUERY_PARAM, toSuggestionKey(suggestion));
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams]
  );

  const closeSuggestionModal = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(SUGGESTION_QUERY_PARAM);
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Text weight="medium">Prompt and context analysis</Text>
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
            <Loader lines={RATING_LOADER_LINES} />
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
              Run a compact analysis of prompt clarity, tool quality, and token risk.
            </Text>
            <div className={styles.actionArea}>
              <Button onClick={() => void runRating()} icon="star" variant="primary">
                Generate analysis
              </Button>
              <div className={styles.actionNote}>
                <Text variant="bodySmall" color="secondary">
                  Usually finishes in under 1 minute.
                </Text>
              </div>
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

            <div className={styles.summary}>{succinctSummary}</div>

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
                  </div>
                  {suggestions.map((suggestion, index) => {
                    const suggestionKey = `${toSuggestionKey(suggestion)}:${index}`;
                    const isMenuOpen = openMenuSuggestionKey === suggestionKey;
                    return (
                      <div
                        key={`${severity}-${index}-${suggestion.category}-${suggestion.title}`}
                        className={styles.suggestionCard}
                      >
                        <div className={styles.suggestionMetaRow}>
                          <span className={styles.suggestionTitleRow}>
                            <span
                              className={styles.suggestionSeverityDot}
                              style={{ backgroundColor: severityDotColor(theme, normalizeSeverity(suggestion.severity)) }}
                              aria-hidden
                            />
                            <button
                              type="button"
                              className={styles.suggestionTitleButton}
                              onClick={() => openSuggestionModal(suggestion)}
                              aria-label={`Open suggestion ${suggestion.title}`}
                            >
                              <Text weight="medium">{suggestion.title}</Text>
                            </button>
                          </span>
                          <span className={styles.suggestionCategory}>{suggestion.category}</span>
                        </div>
                        <div className={styles.suggestionDescriptionRow}>
                          <div className={cx(styles.suggestionDescription, styles.suggestionDescriptionText)}>
                            {toSuccinctText(suggestion.description, SUGGESTION_MAX_CHARS)}
                          </div>
                          <div className={styles.menuWrap} data-suggestion-menu-scope={suggestionKey}>
                            <button
                              type="button"
                              className={styles.menuButton}
                              aria-label={`Suggestion actions for ${suggestion.title}`}
                              aria-expanded={isMenuOpen}
                              onClick={() => setOpenMenuSuggestionKey(isMenuOpen ? null : suggestionKey)}
                            >
                              ...
                            </button>
                            {isMenuOpen && (
                              <div className={styles.menuPanel} role="menu">
                                <button
                                  type="button"
                                  className={styles.menuItem}
                                  role="menuitem"
                                  onClick={() => onExplainSuggestion(suggestion)}
                                >
                                  Explain
                                </button>
                                <button
                                  type="button"
                                  className={styles.menuItem}
                                  role="menuitem"
                                  onClick={() => onRejectSuggestion(suggestion)}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
      {selectedSuggestion && (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeSuggestionModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={`Suggestion ${selectedSuggestion.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleRow}>
                <span
                  className={styles.suggestionSeverityDot}
                  style={{ backgroundColor: severityDotColor(theme, normalizeSeverity(selectedSuggestion.severity)) }}
                  aria-hidden
                />
                <Text weight="medium">{selectedSuggestion.title}</Text>
                <Badge
                  text={normalizeSeverity(selectedSuggestion.severity).toUpperCase()}
                  color={severityBadgeColor(normalizeSeverity(selectedSuggestion.severity))}
                />
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeSuggestionModal}
                aria-label="Close suggestion modal"
              >
                x
              </button>
            </div>
            <Text variant="bodySmall" color="secondary">
              {selectedSuggestion.category}
            </Text>
            <div className={styles.modalBody}>{selectedSuggestion.description}</div>
            <div>
              <Button variant="secondary" icon="sync" onClick={() => onExplainSuggestion(selectedSuggestion)}>
                Explain
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function cx(...classNames: Array<string | undefined>): string {
  return classNames.filter((name): name is string => Boolean(name)).join(' ');
}

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}
