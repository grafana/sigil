import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Icon, Text, useStyles2, useTheme2 } from '@grafana/ui';
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
  onRerun?: () => void;
  onResultChange?: (result: AgentRatingResponse | null) => void;
  dataSource?: AgentsDataSource;
  initialResult?: AgentRatingResponse | null;
  initialLoading?: boolean;
  initialError?: string;
  embedded?: boolean;
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
    height: '100%',
    minHeight: 280,
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
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
    justifyContent: 'flex-start',
    marginTop: theme.spacing(1),
  }),
  scoreRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  scoreMetaStat: css({
    marginLeft: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    gap: theme.spacing(0.125),
    minWidth: 0,
    [`@media (max-width: 640px)`]: {
      width: '100%',
      marginLeft: 0,
      alignItems: 'flex-start',
    },
  }),
  scoreMetaLabel: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    lineHeight: 1.2,
  }),
  scoreMetaValue: css({
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.25,
    fontVariantNumeric: 'tabular-nums',
  }),
  summary: css({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.25),
    color: theme.colors.text.primary,
    lineHeight: 1.5,
    background: `${theme.colors.background.canvas}40`,
    borderRadius: 0,
    padding: theme.spacing(1.5, 3.5),
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(0.75),
    marginLeft: theme.spacing(-2),
    marginRight: theme.spacing(-2),
  }),
  summaryPrefix: css({
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  summaryStatusIcon: css({
    display: 'inline-flex',
    alignItems: 'center',
  }),
  summaryTextButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left' as const,
    textDecoration: 'none',
    textDecorationColor: `${theme.colors.text.secondary}80`,
    textUnderlineOffset: '0.12em',
    '&:hover': {
      textDecoration: 'underline',
      textDecorationColor: theme.colors.text.primary,
    },
  }),
  summaryExplainLink: css({
    marginLeft: theme.spacing(0.75),
    border: 'none',
    background: 'transparent',
    padding: 0,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    textDecoration: 'underline',
    '&:hover': {
      color: theme.colors.text.primary,
    },
  }),
  reportBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
  }),
  reportScrollArea: css({
    flex: 1,
    minHeight: 280,
    maxHeight: 580,
    overflowY: 'auto',
    paddingLeft: theme.spacing(0.5),
    paddingRight: theme.spacing(0.5),
    paddingTop: theme.spacing(0.5),
    paddingBottom: theme.spacing(0.5),
  }),
  suggestionGroup: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  suggestionCard: css({
    padding: theme.spacing(1, 0),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  suggestionCardCompact: css({
    paddingTop: theme.spacing(0.625),
    paddingBottom: theme.spacing(0.75),
    gap: theme.spacing(0.75),
  }),
  suggestionRow: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
  }),
  suggestionContent: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
    minWidth: 0,
    flex: 1,
  }),
  suggestionTitleLine: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    minWidth: 0,
    flexWrap: 'wrap' as const,
  }),
  suggestionTitleMain: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
    flex: '0 1 auto',
  }),
  suggestionOrdinal: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightBold,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.2,
    minWidth: theme.spacing(1.5),
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
    marginTop: theme.spacing(0.125),
    whiteSpace: 'nowrap' as const,
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
    minWidth: 0,
    flex: '0 1 auto',
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
  suggestionTitleText: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    whiteSpace: 'normal' as const,
    overflowWrap: 'anywhere',
  }),
  suggestionSeverityDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    marginRight: theme.spacing(0.25),
  }),
  suggestionCategory: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    lineHeight: 1.2,
    marginBottom: theme.spacing(0.5),
  }),
  suggestionDescription: css({
    color: theme.colors.text.secondary,
    lineHeight: 1.45,
  }),
  suggestionDescriptionRow: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.75),
  }),
  suggestionDescriptionText: css({
    flex: 1,
    minWidth: 0,
  }),
  analysisWarning: css({
    background: 'transparent !important',
    border: 'none !important',
    boxShadow: 'none !important',
  }),
  actionNote: css({
    margin: 0,
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
  rerunButton: css({
    marginLeft: 'auto',
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
    overflow: 'auto',
    color: theme.colors.text.primary,
  }),
});

function summaryStatusTone(theme: GrafanaTheme2, score: number): string {
  if (score >= 7) {
    return theme.colors.text.primary;
  }
  if (score >= 5) {
    return theme.colors.warning.text;
  }
  return theme.colors.error.text;
}

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

export default function AgentRatingPanel({
  agentName,
  version,
  agentStateContext = '',
  contentView = 'preview',
  onRerun,
  onResultChange,
  dataSource = defaultAgentsDataSource,
  initialResult = null,
  initialLoading = false,
  initialError = '',
  embedded = false,
}: AgentRatingPanelProps) {
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

  const renderedSuggestions = useMemo(() => {
    return orderedSuggestions.map((suggestion, index) => {
      const categoryLabel = formatSuggestionCategory(suggestion.category);
      const prevCategoryLabel = index > 0 ? formatSuggestionCategory(orderedSuggestions[index - 1].category) : '';
      return {
        suggestion,
        index,
        categoryLabel,
        showCategory: index === 0 || categoryLabel.toLowerCase() !== prevCategoryLabel.toLowerCase(),
      };
    });
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

  const onClickRerun = useCallback(() => {
    onRerun?.();
    void runRating();
  }, [onRerun, runRating]);

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

  const displayedRewriteMarkdown = rewriteAssistant.isGenerating
    ? String(rewriteAssistant.content ?? '')
    : rewriteMarkdown;

  const panelBody = (
    <>
      <div className={styles.body}>
        {running && (
          <div className={styles.loading}>
            <Loader lines={RATING_LOADER_LINES} align="left" />
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
          <div className={styles.reportBody}>
            <div className={styles.reportScrollArea} aria-label="Agent rating findings">
              <div className={styles.scoreRow}>
                <div className={styles.scoreMetaStat}>
                  <span className={styles.scoreMetaLabel}>Evaluated by</span>
                  <span className={styles.scoreMetaValue}>
                    {completedResult.judge_model} · {completedResult.judge_latency_ms}ms
                  </span>
                </div>
              </div>

              <div className={styles.summary}>
                <span className={styles.summaryPrefix}>tl;dr:</span>
                <span className={styles.summaryStatusIcon}>
                  <Icon
                    name={summaryStatusIconName(completedResult.score)}
                    size="sm"
                    style={{ color: summaryStatusTone(theme, completedResult.score) }}
                  />
                </span>
                <button
                  type="button"
                  className={styles.summaryTextButton}
                  onClick={openSummaryModal}
                  aria-label="Open full rating summary"
                >
                  {succinctSummary}
                </button>
                <button type="button" className={styles.summaryExplainLink} onClick={onExplainReport}>
                  Explain
                </button>
              </div>

              {completedResult.token_warning && completedResult.token_warning.length > 0 && (
                <Alert className={styles.analysisWarning} severity="warning" title="Token budget warning">
                  {completedResult.token_warning}
                </Alert>
              )}

              {renderedSuggestions.map(({ suggestion, index, categoryLabel, showCategory }) => {
                const normalizedSeverity = normalizeSeverity(suggestion.severity);
                return (
                  <div
                    key={`${toSuggestionKey(suggestion)}:${index}`}
                    className={cx(styles.suggestionCard, !showCategory ? styles.suggestionCardCompact : undefined)}
                  >
                    <div className={styles.suggestionRow}>
                      <div className={styles.suggestionContent}>
                        {showCategory && <span className={styles.suggestionCategory}>{categoryLabel}</span>}
                        <span className={styles.suggestionTitleLine}>
                          <span className={styles.suggestionTitleMain}>
                            <span className={styles.suggestionOrdinal} aria-hidden>
                              {index + 1}.
                            </span>
                            <button
                              type="button"
                              className={styles.suggestionTitleButton}
                              onClick={() => openSuggestionModal(index)}
                              aria-label={`Open suggestion ${suggestion.title}`}
                            >
                              <span className={styles.suggestionTitleText}>{suggestion.title}</span>
                            </button>
                          </span>
                          <span
                            className={styles.suggestionSeverityLabel}
                            style={severityLabelStyle(theme, normalizedSeverity)}
                          >
                            {normalizedSeverity}
                          </span>
                        </span>
                        <div className={styles.suggestionDescriptionRow}>
                          <div className={cx(styles.suggestionDescription, styles.suggestionDescriptionText)}>
                            {isPreviewView ? (
                              <MarkdownPreview
                                markdown={toSuccinctText(suggestion.description, SUGGESTION_MAX_CHARS)}
                              />
                            ) : (
                              toSuccinctText(suggestion.description, SUGGESTION_MAX_CHARS)
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.panelActions} aria-label="Agent rating actions">
              <Button variant="secondary" icon="ai" onClick={openRewriteModal}>
                Rewrite prompt
              </Button>
              <Button onClick={onClickRerun} icon="sync" variant="secondary" className={styles.rerunButton}>
                Re-run
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
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
}

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}
