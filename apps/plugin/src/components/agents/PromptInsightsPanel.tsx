import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { css, cx, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Select, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../../agents/api';
import {
  DEFAULT_LOOKBACK,
  LOOKBACK_OPTIONS,
  type PromptInsight,
  type PromptInsightsResponse,
  type PromptInsightsStatus,
} from '../../agents/types';

const lookbackSelectOptions = LOOKBACK_OPTIONS.map((o) => ({ label: o.label, value: o.value }));

export type PromptInsightsPanelProps = {
  agentName: string;
  version?: string;
  dataSource?: AgentsDataSource;
  onInsightsChange?: (insights: PromptInsightsResponse | null) => void;
  onAnalysisTriggered?: () => void;
  onAnalysisStartFailed?: () => void;
  hideControls?: boolean;
  onInsightFocus?: (kind: 'strength' | 'weakness', index: number) => void;
};

export type PromptInsightsPanelHandle = {
  analyze: (lookbackOverride?: string) => void;
  focusInsight: (kind: 'strength' | 'weakness', index: number) => void;
};

const POLL_INTERVAL_MS = 5000;

function normalizeStatus(status: PromptInsightsStatus | string | undefined): PromptInsightsStatus {
  const normalized = (status ?? '').trim().toLowerCase();
  if (normalized === 'pending') {
    return 'pending';
  }
  if (normalized === 'failed') {
    return 'failed';
  }
  return 'completed';
}

function extractErrorStatus(err: unknown): number | undefined {
  if (err != null && typeof err === 'object' && 'status' in err) {
    return (err as { status: number }).status;
  }
  return undefined;
}

const PromptInsightsPanel = forwardRef<PromptInsightsPanelHandle, PromptInsightsPanelProps>(
  function PromptInsightsPanel(
    {
      agentName,
      version,
      dataSource = defaultAgentsDataSource,
      onInsightsChange,
      onAnalysisTriggered,
      onAnalysisStartFailed,
      hideControls = false,
      onInsightFocus,
    },
    ref
  ) {
    const styles = useStyles2(getStyles);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<PromptInsightsResponse | null>(null);
    const [error, setError] = useState('');
    const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());
    const [lookback, setLookback] = useState(DEFAULT_LOOKBACK);
    const [modalOpen, setModalOpen] = useState(false);
    const requestIdRef = useRef(0);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollInFlightRef = useRef(false);
    const cardRefsMap = useRef<Map<string, HTMLButtonElement>>(new Map());

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
            const insights = await dataSource.lookupPromptInsights(agentName, resolvedVersion);
            if (requestIdRef.current !== requestId) {
              return;
            }
            if (insights === null) {
              setRunning(true);
              return;
            }
            const status = normalizeStatus(insights.status);
            if (status === 'pending') {
              setRunning(true);
              return;
            }
            stopPolling();
            if (status === 'failed') {
              setError('Analysis failed. Please try again.');
              setResult(null);
              onInsightsChange?.(null);
            } else {
              setResult(insights);
              setError('');
              onInsightsChange?.(insights);
            }
            setRunning(false);
          } catch {
            // keep polling on transient errors
          } finally {
            pollInFlightRef.current = false;
          }
        };

        pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
      },
      [agentName, version, dataSource, stopPolling, onInsightsChange]
    );

    useEffect(() => {
      return () => stopPolling();
    }, [stopPolling]);

    useEffect(() => {
      const resolvedVersion = version && version.length > 0 ? version : undefined;
      let cancelled = false;

      (async () => {
        try {
          const insights = await dataSource.lookupPromptInsights(agentName, resolvedVersion);
          if (cancelled) {
            return;
          }
          if (insights !== null) {
            const status = normalizeStatus(insights.status);
            if (status === 'pending') {
              setRunning(true);
              const id = ++requestIdRef.current;
              startPolling(id);
            } else if (status === 'completed') {
              setResult(insights);
              onInsightsChange?.(insights);
            }
          }
        } catch {
          // no cached result is fine
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentName, version]);

    const runAnalysis = useCallback(
      async (lookbackOverride?: string) => {
        const resolvedVersion = version && version.length > 0 ? version : undefined;
        const effectiveLookback = lookbackOverride ?? lookback;
        const requestId = ++requestIdRef.current;
        setRunning(true);
        setError('');

        try {
          const response = await dataSource.analyzePrompt(
            agentName,
            resolvedVersion,
            effectiveLookback
          );
          if (requestIdRef.current !== requestId) {
            return;
          }
          onAnalysisTriggered?.();
          const status = normalizeStatus(response.status);
          if (status === 'pending') {
            startPolling(requestId);
          } else if (status === 'completed') {
            setResult(response);
            setRunning(false);
            onInsightsChange?.(response);
          } else {
            setError('Analysis failed. Please try again.');
            setRunning(false);
          }
        } catch (err: unknown) {
          if (requestIdRef.current !== requestId) {
            return;
          }
          console.error('Prompt insights analysis failed', { agentName, version, detail: err });
          onAnalysisStartFailed?.();
          const statusCode = extractErrorStatus(err);
          if (statusCode === 503) {
            setError(
              'No judge provider is configured. Configure a judge provider to enable prompt analysis.'
            );
          } else {
            setError('Failed to start analysis.');
          }
          setRunning(false);
        }
      },
      [
        agentName,
        version,
        lookback,
        dataSource,
        startPolling,
        onInsightsChange,
        onAnalysisTriggered,
        onAnalysisStartFailed,
      ]
    );

    const toggleInsight = useCallback(
      (key: string, kind: 'strength' | 'weakness', index: number) => {
        setExpandedInsights((prev) => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
            onInsightFocus?.(kind, index);
          }
          return next;
        });
      },
      [onInsightFocus]
    );

    const focusInsight = useCallback((kind: 'strength' | 'weakness', index: number) => {
      const key = `${kind}-${index}`;
      setExpandedInsights((prev) => new Set(prev).add(key));
      requestAnimationFrame(() => {
        const el = cardRefsMap.current.get(key);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        analyze: (lookbackOverride?: string) => void runAnalysis(lookbackOverride),
        focusInsight,
      }),
      [runAnalysis, focusInsight]
    );

    const hasResult = result !== null && normalizeStatus(result.status) === 'completed';

    return (
      <div className={styles.container} data-testid="prompt-insights-panel">
        {!hideControls && (
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <Text variant="bodySmall" weight="medium">
                Prompt insights
              </Text>
              {hasResult && (
                <CountBadges
                  strengths={result.strengths.length}
                  weaknesses={result.weaknesses.length}
                />
              )}
            </div>
            <div className={styles.headerRight}>
              <Button
                size="sm"
                variant="secondary"
                icon={running ? undefined : 'search'}
                onClick={() => setModalOpen(true)}
                disabled={running}
                data-testid="analyze-prompt-button"
              >
                {running ? (
                  <>
                    <Spinner inline size="xs" /> Analyzing&hellip;
                  </>
                ) : hasResult ? (
                  'Re-analyze'
                ) : (
                  'Analyze prompt'
                )}
              </Button>
            </div>
          </div>
        )}

        {running && (
          <div className={styles.progressBar}>
            <div className={styles.progressBarFill} />
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <Icon name="exclamation-triangle" size="sm" />
            <Text variant="bodySmall" color="error">
              {error}
            </Text>
          </div>
        )}

        {!hasResult && !running && !error && !hideControls && (
          <div className={styles.emptyHint}>
            <Text variant="bodySmall" color="secondary">
              Identify strengths and potential improvements in your system prompt.
            </Text>
          </div>
        )}

        {hasResult && (
          <div className={styles.results}>
            {hideControls && (
              <div className={styles.summaryRow}>
                <Text variant="bodySmall" weight="medium">
                  Prompt insights
                </Text>
                <CountBadges
                  strengths={result.strengths.length}
                  weaknesses={result.weaknesses.length}
                />
              </div>
            )}
            <InsightGroup
              title="Strengths"
              items={result.strengths}
              kind="strength"
              expandedKeys={expandedInsights}
              onToggle={toggleInsight}
              cardRefsMap={cardRefsMap}
            />
            <InsightGroup
              title="Weaknesses"
              items={result.weaknesses}
              kind="weakness"
              expandedKeys={expandedInsights}
              onToggle={toggleInsight}
              cardRefsMap={cardRefsMap}
            />
            {result.judge_model && (
              <div className={styles.meta}>
                <Text variant="bodySmall" color="secondary">
                  {result.judge_model}
                  {result.judge_latency_ms > 0 &&
                    ` · ${(result.judge_latency_ms / 1000).toFixed(1)}s`}
                </Text>
              </div>
            )}
          </div>
        )}

        {modalOpen && (
          <AnalyzeModal
            lookback={lookback}
            onLookbackChange={setLookback}
            onConfirm={() => {
              setModalOpen(false);
              void runAnalysis();
            }}
            onDismiss={() => setModalOpen(false)}
          />
        )}
      </div>
    );
  }
);

export default PromptInsightsPanel;

type AnalyzeModalProps = {
  lookback: string;
  onLookbackChange: (value: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

export function AnalyzeModal({
  lookback,
  onLookbackChange,
  onConfirm,
  onDismiss,
}: AnalyzeModalProps) {
  const styles = useStyles2(getModalStyles);
  return (
    <div className={styles.backdrop} role="presentation" onClick={onDismiss}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Analyze prompt"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <Text variant="h5">Analyze prompt</Text>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onDismiss}
            aria-label="Close"
          >
            <Icon name="times" />
          </button>
        </div>
        <div className={styles.body}>
          <Text variant="body" color="secondary">
            This analysis evaluates the system prompt by examining recent conversations. It identifies strengths and
            weaknesses based on how the prompt performs in practice.
          </Text>
          <div className={styles.field}>
            <Text variant="bodySmall" weight="medium">
              Consider conversations from
            </Text>
            <Select
              options={lookbackSelectOptions}
              value={lookback}
              onChange={(v) => onLookbackChange(v.value ?? DEFAULT_LOOKBACK)}
              width={20}
              data-testid="lookback-select"
            />
          </div>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" icon="search" onClick={onConfirm}>
            Analyze
          </Button>
          <Button variant="secondary" fill="text" onClick={onDismiss}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function getModalStyles(theme: GrafanaTheme2) {
  return {
    backdrop: css({
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(2),
      zIndex: 1000,
    }),
    dialog: css({
      width: 'min(480px, 100%)',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z3,
      padding: theme.spacing(2.5),
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }),
    closeButton: css({
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
    body: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    field: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    actions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      justifyContent: 'flex-end',
    }),
  };
}

function CountBadges({ strengths, weaknesses }: { strengths: number; weaknesses: number }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.countBadges}>
      <Tooltip content={`${strengths} strength${strengths !== 1 ? 's' : ''} identified`}>
        <span className={styles.strengthBadge}>
          <Icon name="check" size="xs" />
          <span>{strengths}</span>
        </span>
      </Tooltip>
      <Tooltip content={`${weaknesses} area${weaknesses !== 1 ? 's' : ''} for improvement`}>
        <span className={styles.weaknessBadge}>
          <Icon name="exclamation-triangle" size="xs" />
          <span>{weaknesses}</span>
        </span>
      </Tooltip>
    </div>
  );
}

type InsightGroupProps = {
  title: string;
  items: PromptInsight[];
  kind: 'strength' | 'weakness';
  expandedKeys: Set<string>;
  onToggle: (key: string, kind: 'strength' | 'weakness', index: number) => void;
  cardRefsMap: React.RefObject<Map<string, HTMLButtonElement>>;
};

function InsightGroup({
  title,
  items,
  kind,
  expandedKeys,
  onToggle,
  cardRefsMap,
}: InsightGroupProps) {
  const styles = useStyles2(getStyles);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={styles.group}>
      <Text variant="bodySmall" weight="medium" color="secondary">
        {title}
      </Text>
      <div className={styles.groupCards}>
        {items.map((item, idx) => {
          const key = `${kind}-${idx}`;
          return (
            <InsightCard
              key={key}
              cardKey={key}
              item={item}
              kind={kind}
              index={idx}
              isExpanded={expandedKeys.has(key)}
              onToggle={onToggle}
              testId={`insight-item-${kind}-${idx}`}
              cardRefsMap={cardRefsMap}
            />
          );
        })}
      </div>
    </div>
  );
}

type InsightCardProps = {
  cardKey: string;
  item: PromptInsight;
  kind: 'strength' | 'weakness';
  index: number;
  isExpanded: boolean;
  onToggle: (key: string, kind: 'strength' | 'weakness', index: number) => void;
  testId: string;
  cardRefsMap: React.RefObject<Map<string, HTMLButtonElement>>;
};

function InsightCard({
  cardKey,
  item,
  kind,
  index,
  isExpanded,
  onToggle,
  testId,
  cardRefsMap,
}: InsightCardProps) {
  const styles = useStyles2(getStyles);
  const isStrength = kind === 'strength';
  const cardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    const cardRefs = cardRefsMap.current;
    if (!el) {
      return;
    }
    cardRefs.set(cardKey, el);
    return () => {
      cardRefs.delete(cardKey);
    };
  }, [cardKey, cardRefsMap]);

  return (
    <button
      ref={cardRef}
      className={cx(styles.card, isStrength ? styles.cardStrength : styles.cardWeakness)}
      onClick={() => onToggle(cardKey, kind, index)}
      data-testid={testId}
    >
      <div className={styles.cardHeader}>
        <span
          className={cx(
            styles.cardIcon,
            isStrength ? styles.cardIconStrength : styles.cardIconWeakness
          )}
        >
          <Icon name={isStrength ? 'check' : 'exclamation-triangle'} size="xs" />
        </span>
        <Text variant="bodySmall">{item.title}</Text>
        <Icon name={isExpanded ? 'angle-up' : 'angle-down'} size="sm" className={styles.chevron} />
      </div>
      <div className={cx(styles.expandWrapper, isExpanded && styles.expandWrapperOpen)}>
        <div className={styles.expandInner}>
          <div className={styles.cardBody}>
            <Text variant="bodySmall" color="secondary">
              {item.explanation}
            </Text>
            <blockquote className={styles.quote}>
              <Text variant="bodySmall" color="secondary" italic>
                {item.quote.length > 150 ? `${item.quote.slice(0, 150)}…` : item.quote}
              </Text>
            </blockquote>
          </div>
        </div>
      </div>
    </button>
  );
}

const shimmer = keyframes({
  '0%': { transform: 'translateX(-100%)' },
  '100%': { transform: 'translateX(250%)' },
});

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.75),
      marginBottom: theme.spacing(1),
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      flexWrap: 'wrap',
    }),
    headerLeft: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
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
    }),
    countBadges: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    strengthBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      padding: `${theme.spacing(0.125)} ${theme.spacing(0.625)}`,
      borderRadius: 10,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      backgroundColor: `${theme.colors.success.main}1A`,
      color: theme.colors.success.text,
      lineHeight: 1.4,
    }),
    weaknessBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      padding: `${theme.spacing(0.125)} ${theme.spacing(0.625)}`,
      borderRadius: 10,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      backgroundColor: `${theme.colors.warning.main}1A`,
      color: theme.colors.warning.text,
      lineHeight: 1.4,
    }),
    progressBar: css({
      height: 2,
      borderRadius: 1,
      backgroundColor: theme.colors.border.weak,
      overflow: 'hidden',
      position: 'relative',
    }),
    progressBarFill: css({
      position: 'absolute',
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
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    group: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    groupCards: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.375),
    }),
    card: css({
      all: 'unset',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: theme.shape.radius.default,
      borderLeft: '3px solid transparent',
      background: theme.colors.background.primary,
      cursor: 'pointer',
      transition: 'background 0.15s ease, box-shadow 0.15s ease',
      '&:hover': {
        background: theme.colors.action.hover,
        boxShadow: theme.shadows.z1,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.border}`,
        outlineOffset: -2,
      },
    }),
    cardStrength: css({
      borderLeftColor: theme.colors.success.main,
    }),
    cardWeakness: css({
      borderLeftColor: theme.colors.warning.main,
    }),
    cardHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: theme.spacing(0.625, 0.75),
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
    cardIconStrength: css({
      color: theme.colors.success.text,
      backgroundColor: `${theme.colors.success.main}1A`,
    }),
    cardIconWeakness: css({
      color: theme.colors.warning.text,
      backgroundColor: `${theme.colors.warning.main}1A`,
    }),
    chevron: css({
      marginLeft: 'auto',
      color: theme.colors.text.secondary,
      transition: 'transform 0.2s ease',
    }),
    expandWrapper: css({
      display: 'grid',
      gridTemplateRows: '0fr',
      transition: 'grid-template-rows 0.25s ease-out',
    }),
    expandWrapperOpen: css({
      gridTemplateRows: '1fr',
    }),
    expandInner: css({
      overflow: 'hidden',
      minHeight: 0,
    }),
    cardBody: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      padding: theme.spacing(0, 0.75, 0.75, 0.75),
      paddingLeft: `calc(${theme.spacing(0.75)} + 20px + ${theme.spacing(0.5)})`,
    }),
    quote: css({
      margin: 0,
      paddingLeft: theme.spacing(1),
      borderLeft: `2px solid ${theme.colors.border.medium}`,
    }),
    meta: css({
      paddingTop: theme.spacing(0.25),
    }),
  };
}
