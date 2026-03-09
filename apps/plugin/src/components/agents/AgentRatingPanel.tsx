import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Icon, Spinner, Text, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import { createAssistantContextItem, useAssistant, useInlineAssistant } from '@grafana/assistant';
import { useSearchParams } from 'react-router-dom';
import { defaultAgentsDataSource, type AgentsDataSource } from '../../agents/api';
import type { AgentRatingResponse, AgentRatingStatus, AgentRatingSuggestion } from '../../agents/types';
import { Loader } from '../Loader';
import MarkdownPreview from '../markdown/MarkdownPreview';
import { isNotFoundError } from '../../utils/http';

export type AgentRatingPanelProps = {
  agentName: string;
  version?: string;
  agentStateContext?: string;
  contentView?: 'preview' | 'markdown';
  onResultChange?: (result: AgentRatingResponse | null) => void;
  dataSource?: AgentsDataSource;
  initialResult?: AgentRatingResponse | null;
  initialLoading?: boolean;
  initialError?: string;
  embedded?: boolean;
  hideGenerateCta?: boolean;
};

export type AgentRatingPanelHandle = {
  analyze: () => void;
};

const severityOrder = ['high', 'medium', 'low'] as const;
const ratingPollingIntervalMs = 5000;
const SUMMARY_MAX_CHARS = 160;
const SUGGESTION_MAX_CHARS = 110;
const MAX_SUGGESTIONS_TOTAL = 10;
const SUGGESTION_QUERY_PARAM = 'suggestion';
const REWRITE_SYSTEM_PROMPT = [
  'You are an expert prompt engineer.',
  'Given the current agent context and analysis report, rewrite the system prompt to improve quality and safety.',
  'Return markdown only.',
  'Include exactly these sections in this order:',
  '## Rewritten system prompt',
  '```text',
  '<rewritten system prompt>',
  '```',
  '## Why this is better',
  '- <3-6 concise bullets tied to report findings>',
].join('\n');

const shimmer = keyframes({
  '0%': { transform: 'translateX(-100%)' },
  '100%': { transform: 'translateX(250%)' },
});

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    overflow: 'visible',
  }),
  embeddedRoot: css({
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
    gap: theme.spacing(0.75),
    padding: theme.spacing(1.5),
  }),
  bodyEmbedded: css({
    padding: 0,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  headerLeft: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  headerRight: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  summaryRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  metricBadges: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
  }),
  metricBadge: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: `${theme.spacing(0.125)} ${theme.spacing(0.625)}`,
    borderRadius: 10,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.4,
  }),
  metricBadgeStrong: css({
    backgroundColor: `${theme.colors.success.main}1A`,
    color: theme.colors.success.text,
  }),
  metricBadgeMixed: css({
    backgroundColor: `${theme.colors.warning.main}1A`,
    color: theme.colors.warning.text,
  }),
  metricBadgeWeak: css({
    backgroundColor: `${theme.colors.error.main}1A`,
    color: theme.colors.error.text,
  }),
  metricBadgeNeutral: css({
    backgroundColor: theme.colors.action.hover,
    color: theme.colors.text.secondary,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'flex-start',
    marginTop: theme.spacing(1),
  }),
  progressState: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  progressBar: css({
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.border.weak,
    overflow: 'hidden',
    position: 'relative' as const,
  }),
  progressBarFill: css({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    width: '30%',
    borderRadius: 1,
    background: `linear-gradient(90deg, ${theme.colors.primary.main}, ${theme.colors.primary.shade})`,
    animation: `${shimmer} 1.5s ease-in-out infinite`,
  }),
  error: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.error.text,
  }),
  emptyHint: css({
    padding: theme.spacing(0.25, 0),
  }),
  results: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    minHeight: 0,
    flex: 1,
  }),
  reportBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    flex: 1,
  }),
  reportScrollArea: css({
    flex: 1,
    minHeight: 220,
    maxHeight: 580,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    paddingRight: theme.spacing(0.25),
  }),
  reportScrollAreaEmbedded: css({
    minHeight: 0,
    maxHeight: 'none',
    overflowY: 'visible' as const,
    paddingRight: 0,
  }),
  group: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  groupCards: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.375),
  }),
  card: css({
    display: 'flex',
    flexDirection: 'column' as const,
    borderRadius: theme.shape.radius.default,
    borderLeft: '3px solid transparent',
    background: theme.colors.background.primary,
    transition: 'background 0.15s ease, box-shadow 0.15s ease',
    minWidth: 0,
  }),
  cardButton: css({
    all: 'unset',
    display: 'flex',
    flexDirection: 'column' as const,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
      boxShadow: theme.shadows.z1,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.border}`,
      outlineOffset: -2,
    },
  }),
  cardStatic: css({
    cursor: 'default',
  }),
  cardStrong: css({
    borderLeftColor: theme.colors.success.main,
  }),
  cardMixed: css({
    borderLeftColor: theme.colors.warning.main,
  }),
  cardWeak: css({
    borderLeftColor: theme.colors.error.main,
  }),
  cardLow: css({
    borderLeftColor: theme.colors.info.main,
  }),
  cardHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.625, 0.75),
    minWidth: 0,
  }),
  cardIcon: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  cardIconStrong: css({
    color: theme.colors.success.text,
    backgroundColor: `${theme.colors.success.main}1A`,
  }),
  cardIconMixed: css({
    color: theme.colors.warning.text,
    backgroundColor: `${theme.colors.warning.main}1A`,
  }),
  cardIconWeak: css({
    color: theme.colors.error.text,
    backgroundColor: `${theme.colors.error.main}1A`,
  }),
  cardIconLow: css({
    color: theme.colors.info.text,
    backgroundColor: `${theme.colors.info.main}1A`,
  }),
  cardTextBlock: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.125),
    minWidth: 0,
    flex: 1,
  }),
  cardTitle: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.35,
    overflowWrap: 'anywhere' as const,
  }),
  cardMeta: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.3,
    overflowWrap: 'anywhere' as const,
  }),
  inlineToneBadge: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    marginLeft: theme.spacing(0.5),
    padding: `${theme.spacing(0.125)} ${theme.spacing(0.5)}`,
    borderRadius: 999,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.3,
    flexShrink: 0,
  }),
  suggestionSeverityLabel: css({
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: theme.shape.radius.pill,
    padding: `${theme.spacing(0.125)} ${theme.spacing(0.625)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
    lineHeight: 1.2,
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  }),
  chevron: css({
    marginLeft: theme.spacing(0.25),
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  cardBody: css({
    padding: theme.spacing(0, 0.75, 0.75, 0.75),
    paddingLeft: `calc(${theme.spacing(0.75)} + 20px + ${theme.spacing(0.5)})`,
    color: theme.colors.text.secondary,
    lineHeight: 1.45,
  }),
  panelActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    flexWrap: 'wrap' as const,
    marginTop: theme.spacing(1),
    paddingTop: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
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
    overflow: 'auto' as const,
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
  suggestionSeverityDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    marginRight: theme.spacing(0.25),
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
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap' as const,
  }),
  modalActions: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.75),
  }),
  rewriteTitle: css({
    margin: 0,
  }),
  rewriteMeta: css({
    margin: 0,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
  }),
  rewriteBodyPreview: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: theme.spacing(1),
    maxHeight: '50vh',
    overflow: 'auto' as const,
    color: theme.colors.text.primary,
  }),
});

function summaryStatusIconName(score: number): 'check' | 'exclamation-triangle' {
  return score >= 7 ? 'check' : 'exclamation-triangle';
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

function severityLabelStyle(theme: GrafanaTheme2, severity: 'high' | 'medium' | 'low'): React.CSSProperties {
  if (severity === 'high') {
    return { color: theme.colors.error.text, background: theme.colors.error.transparent };
  }
  if (severity === 'medium') {
    return { color: theme.colors.warning.text, background: theme.colors.warning.transparent };
  }
  return { color: theme.colors.info.text, background: theme.colors.info.transparent };
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

function formatSuggestionCategory(category: string): string {
  const normalized = category
    .trim()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!normalized) {
    return 'General';
  }
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
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

function logRatingGenerationFailure(agentName: string, version: string | undefined, detail: unknown): void {
  console.error('Agent rating generation failed', {
    agentName,
    version: version ?? 'latest',
    detail,
  });
}

const AgentRatingPanel = forwardRef<AgentRatingPanelHandle, AgentRatingPanelProps>(function AgentRatingPanel(
  {
    agentName,
    version,
    agentStateContext = '',
    contentView = 'preview',
    onResultChange,
    dataSource = defaultAgentsDataSource,
    initialResult = null,
    initialLoading = false,
    initialError = '',
    embedded = false,
    hideGenerateCta = false,
  },
  ref
) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const assistant = useAssistant();
  const rewriteAssistant = useInlineAssistant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [running, setRunning] = useState<boolean>(
    initialLoading || (initialResult !== null && normalizeRatingStatus(initialResult.status) === 'pending')
  );
  const [result, setResult] = useState<AgentRatingResponse | null>(initialResult);
  const [error, setError] = useState<string>(initialError);
  const [rejectedSuggestionKeys, setRejectedSuggestionKeys] = useState<Record<string, true>>({});
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
  const [rewriteMarkdown, setRewriteMarkdown] = useState('');
  const [rewriteError, setRewriteError] = useState('');
  const requestIdRef = useRef(0);
  const rewriteRequestIdRef = useRef(0);
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
            setRunning(false);
            setError('Agent rating failed. Please try again.');
            logRatingGenerationFailure(agentName, resolvedVersion, 'rating status failed while polling');
            return;
          }
          setResult(rating);
          onResultChange?.(rating);
          setRunning(false);
          setError('');
        } catch (err: unknown) {
          if (requestIdRef.current !== requestId) {
            return;
          }
          if (isNotFoundError(err)) {
            // A newly triggered rating can briefly 404 before it is materialized.
            // Keep polling so the panel does not drop back to the empty state.
            setRunning(true);
            setError('');
            return;
          }
          stopPolling();
          setRunning(false);
          logRatingGenerationFailure(agentName, resolvedVersion, err);
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
    [agentName, dataSource, onResultChange, stopPolling, version]
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

  useEffect(() => {
    setRejectedSuggestionKeys({});
    setSummaryModalOpen(false);
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

  const orderedSuggestions = useMemo(() => {
    return severityOrder.flatMap((severity) => groupedSuggestions[severity]);
  }, [groupedSuggestions]);

  const suggestionSections = useMemo(() => {
    return severityOrder
      .map((severity) => ({
        severity,
        title: formatSeverityHeading(severity),
        items: orderedSuggestions
          .map((suggestion, index) => ({ suggestion, index }))
          .filter((item) => normalizeSeverity(item.suggestion.severity) === severity),
      }))
      .filter((section) => section.items.length > 0);
  }, [orderedSuggestions]);

  const selectedSuggestionIndexRaw = searchParams.get(SUGGESTION_QUERY_PARAM)?.trim() ?? '';
  const selectedSuggestionIndex =
    selectedSuggestionIndexRaw.length > 0 ? Number.parseInt(selectedSuggestionIndexRaw, 10) : Number.NaN;
  const selectedSuggestion =
    Number.isFinite(selectedSuggestionIndex) && selectedSuggestionIndex >= 0
      ? (orderedSuggestions[selectedSuggestionIndex] ?? null)
      : null;

  const succinctSummary = useMemo(() => {
    if (!completedResult) {
      return '';
    }
    return toSuccinctText(completedResult.summary, SUMMARY_MAX_CHARS);
  }, [completedResult]);
  const isPreviewView = contentView === 'preview';

  const runRating = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    stopPolling();
    setRunning(true);
    setError('');
    const resolvedVersion = version && version.length > 0 ? version : undefined;

    try {
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
        setError('Agent rating failed. Please try again.');
        logRatingGenerationFailure(agentName, resolvedVersion, 'rating status failed');
        return;
      }
      setResult(rating);
      onResultChange?.(rating);
      setRunning(false);
    } catch (err: unknown) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setRunning(false);
      logRatingGenerationFailure(agentName, version && version.length > 0 ? version : undefined, err);
      setError(err instanceof Error ? err.message : 'Failed to evaluate agent');
    }
  }, [agentName, dataSource, onResultChange, startPolling, stopPolling, version]);

  const onExplainSuggestion = useCallback(
    (suggestion: AgentRatingSuggestion) => {
      const next = new URLSearchParams(searchParams);
      next.delete(SUGGESTION_QUERY_PARAM);
      setSearchParams(next, { replace: false });
      const prompt = 'Explain this recommendation in plain language and start a short discovery conversation.';
      const contextItems = [
        createAssistantContextItem('structured', {
          title: 'Recommendation',
          data: {
            severity: normalizeSeverity(suggestion.severity),
            category: formatSuggestionCategory(suggestion.category),
            title: suggestion.title,
            description: suggestion.description,
          },
        }),
      ];
      if (!assistant.openAssistant) {
        const fallbackPrompt = [
          prompt,
          '',
          'Recommendation',
          `Severity: ${normalizeSeverity(suggestion.severity)}`,
          `Category: ${formatSuggestionCategory(suggestion.category)}`,
          `Title: ${suggestion.title}`,
          `Description: ${suggestion.description}`,
        ].join('\n');
        window.location.href = buildAssistantUrl(fallbackPrompt);
        return;
      }
      assistant.openAssistant({
        origin: 'sigil-agent-rating',
        prompt,
        autoSend: true,
        context: contextItems,
      });
    },
    [assistant, searchParams, setSearchParams]
  );

  const onExplainReport = useCallback(() => {
    if (!completedResult) {
      return;
    }
    const resolvedVersion = version && version.length > 0 ? version : 'latest';
    const suggestionsText = orderedSuggestions.length
      ? orderedSuggestions
          .map((suggestion, index) => {
            const severity = normalizeSeverity(suggestion.severity);
            return `${index + 1}. [${severity.toUpperCase()}] ${formatSuggestionCategory(suggestion.category)} - ${suggestion.title}\n${suggestion.description}`;
          })
          .join('\n\n')
      : 'None.';
    const prompt =
      'Start a collaborative discovery conversation about these findings. Lead with 2-3 focused questions to validate assumptions and prioritize improvements.';
    const contextItems = [
      createAssistantContextItem('structured', {
        title: 'Rating summary',
        data: {
          agent: agentName,
          version: resolvedVersion,
          score: `${completedResult.score}/10`,
          summary: completedResult.summary,
          token_warning: completedResult.token_warning ?? 'none',
        },
      }),
      createAssistantContextItem('structured', {
        title: 'Suggestions',
        data: {
          items: suggestionsText,
        },
      }),
      createAssistantContextItem('structured', {
        title: 'Additional agent state',
        data: {
          details:
            agentStateContext.trim().length > 0 ? agentStateContext.trim() : 'No additional state context provided.',
        },
      }),
    ];
    if (!assistant.openAssistant) {
      const fallbackPrompt = [
        prompt,
        '',
        'Rating summary',
        `Agent: ${agentName}`,
        `Version: ${resolvedVersion}`,
        `Score: ${completedResult.score}/10`,
        `Summary: ${completedResult.summary}`,
        completedResult.token_warning ? `Token warning: ${completedResult.token_warning}` : 'Token warning: none',
        '',
        'Suggestions',
        suggestionsText,
        '',
        'Additional agent state',
        agentStateContext.trim().length > 0 ? agentStateContext.trim() : 'No additional state context provided.',
      ].join('\n');
      window.location.href = buildAssistantUrl(fallbackPrompt);
      return;
    }
    assistant.openAssistant({
      origin: 'sigil-agent-rating',
      prompt,
      autoSend: true,
      context: contextItems,
    });
  }, [agentName, agentStateContext, assistant, completedResult, orderedSuggestions, version]);

  const onRejectSuggestion = useCallback(
    (suggestion: AgentRatingSuggestion) => {
      const key = toSuggestionKey(suggestion);
      setRejectedSuggestionKeys((prev) => ({ ...prev, [toSuggestionKey(suggestion)]: true }));
      if (selectedSuggestion && toSuggestionKey(selectedSuggestion) === key) {
        const next = new URLSearchParams(searchParams);
        next.delete(SUGGESTION_QUERY_PARAM);
        setSearchParams(next, { replace: false });
      }
    },
    [searchParams, selectedSuggestion, setSearchParams]
  );

  const openSuggestionModal = useCallback(
    (suggestionIndex: number) => {
      const next = new URLSearchParams(searchParams);
      next.set(SUGGESTION_QUERY_PARAM, String(suggestionIndex));
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams]
  );

  const closeSuggestionModal = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(SUGGESTION_QUERY_PARAM);
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const openSummaryModal = useCallback(() => {
    setSummaryModalOpen(true);
  }, []);

  const closeSummaryModal = useCallback(() => {
    setSummaryModalOpen(false);
  }, []);

  const onExplainSummaryModal = useCallback(() => {
    setSummaryModalOpen(false);
    onExplainReport();
  }, [onExplainReport]);

  const runRewritePrompt = useCallback(() => {
    if (!completedResult) {
      return;
    }
    const resolvedVersion = version && version.length > 0 ? version : 'latest';
    const rewriteSuggestions = completedResult.suggestions ?? [];
    const suggestionsText = rewriteSuggestions.length
      ? rewriteSuggestions
          .map((suggestion, index) => {
            const severity = normalizeSeverity(suggestion.severity);
            return `${index + 1}. [${severity.toUpperCase()}] ${formatSuggestionCategory(suggestion.category)} - ${suggestion.title}\n${suggestion.description}`;
          })
          .join('\n\n')
      : 'None.';
    const prompt = [
      'Create a stronger system prompt alternative based on this agent context and rating report.',
      '',
      '## Current agent state',
      `- Agent name: ${agentName}`,
      `- Version: ${resolvedVersion}`,
      agentStateContext.trim().length > 0 ? agentStateContext.trim() : '- No additional state context provided.',
      '',
      '## Analysis report',
      `- Score: ${completedResult.score}/10`,
      `- Summary: ${completedResult.summary}`,
      completedResult.token_warning ? `- Token warning: ${completedResult.token_warning}` : '- Token warning: none',
      '',
      '### Suggestions',
      suggestionsText,
    ].join('\n');

    rewriteRequestIdRef.current += 1;
    const requestId = rewriteRequestIdRef.current;
    setRewriteError('');
    setRewriteMarkdown('');
    rewriteAssistant.generate({
      agentName: 'fe-inline-sigil-plugin-prompt-rewrite',
      agentId: 'v1',
      origin: 'sigil-agent-rating-rewrite',
      prompt,
      systemPrompt: REWRITE_SYSTEM_PROMPT,
      onComplete: (result: string) => {
        if (rewriteRequestIdRef.current !== requestId) {
          return;
        }
        setRewriteMarkdown(result);
      },
      onError: (err: Error) => {
        if (rewriteRequestIdRef.current !== requestId) {
          return;
        }
        setRewriteMarkdown('');
        setRewriteError(err.message || 'Failed to rewrite prompt.');
      },
    });
  }, [agentName, agentStateContext, completedResult, rewriteAssistant, version]);

  const openRewriteModal = useCallback(() => {
    setRewriteModalOpen(true);
    runRewritePrompt();
  }, [runRewritePrompt]);

  const closeRewriteModal = useCallback(() => {
    rewriteRequestIdRef.current += 1;
    setRewriteModalOpen(false);
  }, []);

  useImperativeHandle(ref, () => ({ analyze: () => void runRating() }), [runRating]);

  const displayedRewriteMarkdown = rewriteAssistant.isGenerating
    ? String(rewriteAssistant.content ?? '')
    : rewriteMarkdown;

  const totalFindingCount = orderedSuggestions.length + (completedResult?.token_warning ? 1 : 0);

  const panelBody = (
    <div className={cx(styles.body, embedded && styles.bodyEmbedded)}>
      {!hideGenerateCta && (
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Text variant="bodySmall" weight="medium">
              Prompt rating
            </Text>
            {completedResult && <RatingBadges score={completedResult.score} findings={totalFindingCount} />}
          </div>
          <div className={styles.headerRight}>
            <Button
              size="sm"
              variant="secondary"
              icon={running ? undefined : 'search'}
              onClick={() => void runRating()}
              disabled={running}
            >
              {running ? (
                <>
                  <Spinner inline size="xs" /> Analyzing&hellip;
                </>
              ) : completedResult ? (
                'Re-analyze'
              ) : (
                'Generate analysis'
              )}
            </Button>
          </div>
        </div>
      )}

      {running && (
        <div className={styles.progressState}>
          <div className={styles.progressBar} role="progressbar" aria-label="Generating rating">
            <div className={styles.progressBarFill} />
          </div>
          <Text variant="bodySmall" color="secondary">
            Reviewing prompt structure, tool quality, and token budget.
          </Text>
        </div>
      )}

      {error.length > 0 && (
        <div className={styles.error}>
          <Icon name="exclamation-triangle" size="sm" />
          <Text variant="bodySmall" color="error">
            {error}
          </Text>
        </div>
      )}

      {!running && !completedResult && !hideGenerateCta && (
        <div className={styles.emptyHint}>
          <Text variant="bodySmall" color="secondary">
            Evaluate prompt clarity, tool design, and token risk with the same structured view as prompt insights.
          </Text>
        </div>
      )}

      {!running && completedResult && (
        <div className={styles.results}>
          {hideGenerateCta && (
            <div className={styles.summaryRow}>
              <Text variant="bodySmall" weight="medium">
                Prompt rating
              </Text>
              <RatingBadges score={completedResult.score} findings={totalFindingCount} />
            </div>
          )}

          <div className={styles.reportBody}>
            <div
              className={cx(styles.reportScrollArea, embedded && styles.reportScrollAreaEmbedded)}
              aria-label="Agent rating findings"
            >
              <div className={styles.group}>
                <Text variant="bodySmall" weight="medium" color="secondary">
                  Overview
                </Text>
                <div className={styles.groupCards}>
                  <RatingSummaryCard
                    score={completedResult.score}
                    summary={succinctSummary}
                    judgeModel={completedResult.judge_model}
                    judgeLatencyMs={completedResult.judge_latency_ms}
                    onOpen={openSummaryModal}
                  />
                </div>
              </div>

              {completedResult.token_warning && completedResult.token_warning.length > 0 && (
                <div className={styles.group}>
                  <Text variant="bodySmall" weight="medium" color="secondary">
                    Warnings
                  </Text>
                  <div className={styles.groupCards}>
                    <RatingWarningCard warning={completedResult.token_warning} />
                  </div>
                </div>
              )}

              {suggestionSections.map((section) => (
                <RatingSuggestionSection
                  key={section.severity}
                  title={section.title}
                  severity={section.severity}
                  items={section.items}
                  onOpen={openSuggestionModal}
                />
              ))}
            </div>

            <div className={styles.panelActions} aria-label="Agent rating actions">
              <Button variant="secondary" icon="ai" onClick={onExplainReport}>
                Explain
              </Button>
              <Button variant="secondary" icon="ai" onClick={openRewriteModal}>
                Rewrite prompt
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={embedded ? styles.embeddedRoot : styles.panel}>
      {panelBody}
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
              {formatSuggestionCategory(selectedSuggestion.category).toUpperCase()}
            </Text>
            <div className={styles.modalBody}>
              {isPreviewView ? (
                <MarkdownPreview markdown={selectedSuggestion.description} />
              ) : (
                selectedSuggestion.description
              )}
            </div>
            <div className={styles.modalActions}>
              <Button variant="secondary" icon="ai" onClick={() => onExplainSuggestion(selectedSuggestion)}>
                Explain
              </Button>
              <Button variant="destructive" onClick={() => onRejectSuggestion(selectedSuggestion)}>
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
      {summaryModalOpen && completedResult && (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeSummaryModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Rating summary"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <Text weight="medium">Rating summary</Text>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeSummaryModal}
                aria-label="Close rating summary modal"
              >
                x
              </button>
            </div>
            <div className={styles.modalBody}>
              {isPreviewView ? <MarkdownPreview markdown={completedResult.summary} /> : completedResult.summary}
            </div>
            <div className={styles.modalActions}>
              <Button variant="secondary" icon="ai" onClick={onExplainSummaryModal}>
                Explain
              </Button>
              <Button variant="secondary" onClick={closeSummaryModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      {rewriteModalOpen && completedResult && (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeRewriteModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Rewrite prompt"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.rewriteTitle}>Rewrite prompt</h3>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeRewriteModal}
                aria-label="Close rewrite prompt modal"
              >
                x
              </button>
            </div>
            <p className={styles.rewriteMeta}>
              Generated from the current agent state and rating report. Output is markdown.
            </p>
            {rewriteError.length > 0 && (
              <Alert severity="error" title="Rewrite failed">
                {rewriteError}
              </Alert>
            )}
            {displayedRewriteMarkdown.trim().length > 0 ? (
              <div className={styles.rewriteBodyPreview}>
                <MarkdownPreview markdown={displayedRewriteMarkdown} />
              </div>
            ) : (
              <div className={styles.loading}>
                <Loader showText={false} />
              </div>
            )}
            <div className={styles.modalActions}>
              <Button
                variant="secondary"
                icon="sync"
                onClick={runRewritePrompt}
                disabled={rewriteAssistant.isGenerating}
              >
                Regenerate
              </Button>
              <Button variant="secondary" onClick={closeRewriteModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function scoreToneKey(score: number): 'strong' | 'mixed' | 'weak' {
  if (score >= 7) {
    return 'strong';
  }
  if (score >= 5) {
    return 'mixed';
  }
  return 'weak';
}

function formatJudgeMeta(judgeModel: string, judgeLatencyMs: number): string {
  const model = judgeModel.trim();
  if (!model) {
    return 'Judge unavailable';
  }
  if (judgeLatencyMs > 0) {
    return `${model} · ${(judgeLatencyMs / 1000).toFixed(1)}s`;
  }
  return model;
}

function formatSeverityHeading(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') {
    return 'High priority';
  }
  if (severity === 'medium') {
    return 'Medium priority';
  }
  return 'Low priority';
}

function severityIconName(severity: 'high' | 'medium' | 'low'): 'exclamation-triangle' | 'info-circle' {
  if (severity === 'low') {
    return 'info-circle';
  }
  return 'exclamation-triangle';
}

function RatingBadges({ score, findings }: { score: number; findings: number }) {
  const styles = useStyles2(getStyles);
  const tone = scoreToneKey(score);
  return (
    <div className={styles.metricBadges}>
      <Tooltip content={`Overall rating ${score}/10`}>
        <span
          className={cx(
            styles.metricBadge,
            tone === 'strong'
              ? styles.metricBadgeStrong
              : tone === 'mixed'
                ? styles.metricBadgeMixed
                : styles.metricBadgeWeak
          )}
        >
          <Icon name={summaryStatusIconName(score)} size="xs" />
          <span>{score}/10</span>
        </span>
      </Tooltip>
      <Tooltip content={`${findings} finding${findings !== 1 ? 's' : ''}`}>
        <span className={cx(styles.metricBadge, styles.metricBadgeNeutral)}>
          <Icon name="exclamation-triangle" size="xs" />
          <span>{findings}</span>
        </span>
      </Tooltip>
    </div>
  );
}

type RatingSummaryCardProps = {
  score: number;
  summary: string;
  judgeModel: string;
  judgeLatencyMs: number;
  onOpen: () => void;
};

function RatingSummaryCard({ score, summary, judgeModel, judgeLatencyMs, onOpen }: RatingSummaryCardProps) {
  const styles = useStyles2(getStyles);
  const tone = scoreToneKey(score);
  return (
    <button
      type="button"
      className={cx(
        styles.card,
        styles.cardButton,
        tone === 'strong' ? styles.cardStrong : tone === 'mixed' ? styles.cardMixed : styles.cardWeak
      )}
      onClick={onOpen}
      aria-label="Open full rating summary"
    >
      <div className={styles.cardHeader}>
        <span
          className={cx(
            styles.cardIcon,
            tone === 'strong' ? styles.cardIconStrong : tone === 'mixed' ? styles.cardIconMixed : styles.cardIconWeak
          )}
        >
          <Icon name={summaryStatusIconName(score)} size="xs" />
        </span>
        <div className={styles.cardTextBlock}>
          <span className={styles.cardTitle}>Overall rating</span>
          <span className={styles.cardMeta}>{formatJudgeMeta(judgeModel, judgeLatencyMs)}</span>
        </div>
        <span
          className={cx(
            styles.inlineToneBadge,
            tone === 'strong'
              ? styles.metricBadgeStrong
              : tone === 'mixed'
                ? styles.metricBadgeMixed
                : styles.metricBadgeWeak
          )}
        >
          {score}/10
        </span>
        <Icon name="angle-right" size="sm" className={styles.chevron} />
      </div>
      <div className={styles.cardBody}>
        <Text variant="bodySmall" color="secondary">
          {summary}
        </Text>
      </div>
    </button>
  );
}

function RatingWarningCard({ warning }: { warning: string }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={cx(styles.card, styles.cardStatic, styles.cardMixed)}>
      <div className={styles.cardHeader}>
        <span className={cx(styles.cardIcon, styles.cardIconMixed)}>
          <Icon name="exclamation-triangle" size="xs" />
        </span>
        <div className={styles.cardTextBlock}>
          <span className={styles.cardTitle}>Token budget warning</span>
          <span className={styles.cardMeta}>This rating flagged baseline context size as a likely risk.</span>
        </div>
      </div>
      <div className={styles.cardBody}>
        <Text variant="bodySmall" color="secondary">
          {warning}
        </Text>
      </div>
    </div>
  );
}

type RatingSuggestionSectionProps = {
  title: string;
  severity: 'high' | 'medium' | 'low';
  items: Array<{ suggestion: AgentRatingSuggestion; index: number }>;
  onOpen: (index: number) => void;
};

function RatingSuggestionSection({ title, severity, items, onOpen }: RatingSuggestionSectionProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const toneClass = severity === 'high' ? styles.cardWeak : severity === 'medium' ? styles.cardMixed : styles.cardLow;
  const iconClass =
    severity === 'high' ? styles.cardIconWeak : severity === 'medium' ? styles.cardIconMixed : styles.cardIconLow;

  return (
    <div className={styles.group}>
      <Text variant="bodySmall" weight="medium" color="secondary">
        {title}
      </Text>
      <div className={styles.groupCards}>
        {items.map(({ suggestion, index }) => (
          <button
            key={`${toSuggestionKey(suggestion)}:${index}`}
            type="button"
            className={cx(styles.card, styles.cardButton, toneClass)}
            onClick={() => onOpen(index)}
            aria-label={`Open suggestion ${suggestion.title}`}
          >
            <div className={styles.cardHeader}>
              <span className={cx(styles.cardIcon, iconClass)}>
                <Icon name={severityIconName(severity)} size="xs" />
              </span>
              <div className={styles.cardTextBlock}>
                <span className={styles.cardTitle}>{suggestion.title}</span>
                <span className={styles.cardMeta}>{formatSuggestionCategory(suggestion.category)}</span>
              </div>
              <span className={styles.suggestionSeverityLabel} style={severityLabelStyle(theme, severity)}>
                {severity}
              </span>
              <Icon name="angle-right" size="sm" className={styles.chevron} />
            </div>
            <div className={styles.cardBody}>
              <Text variant="bodySmall" color="secondary">
                {toSuccinctText(suggestion.description, SUGGESTION_MAX_CHARS)}
              </Text>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default AgentRatingPanel;

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}
