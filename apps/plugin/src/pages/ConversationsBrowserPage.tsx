import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, makeTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Alert, Spinner, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { loadConversation as loadConversationData, type TraceFetcher } from '../conversation/loader';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import { findSpanBySelectionID, getSelectionID } from '../conversation/spans';
import {
  getTokenSummary,
  getCostSummary,
  getAllGenerations,
  type TokenSummary,
  type CostSummary,
} from '../conversation/aggregates';
import { resolveGenerationCosts } from '../generation/cost';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import type { GenerationCostResult } from '../generation/types';
import type { ConversationData, ConversationSearchResult, ConversationSpan } from '../conversation/types';
import ConversationColumn from '../components/conversations/ConversationColumn';
import ConversationListPanel from '../components/conversations/ConversationListPanel';
import { buildConversationViewRoute, ROUTES } from '../constants';

export type ConversationsBrowserPageProps = {
  dataSource?: ConversationsDataSource;
  traceFetcher?: TraceFetcher;
  modelCardClient?: ModelCardClient;
};

const defaultTraceFetcher = createTempoTraceFetcher();

const DEFAULT_TIME_RANGE_HOURS = 1;
const SDK_NAME_SELECT_KEY = 'span.sigil.sdk.name';
const TOTAL_TOKENS_SELECT_KEY = 'span.gen_ai.usage.total_tokens';
const DEFAULT_SEARCH_SELECT_FIELDS = [SDK_NAME_SELECT_KEY];

type StatTrendDirection = 'up' | 'down' | 'neutral';
type ConversationStats = {
  totalConversations: number;
  totalTokens: number;
  avgCallsPerConversation: number;
  activeLast7d: number;
  ratedConversations: number;
  badRatedPct: number;
};

function defaultTimeRange(): TimeRange {
  const now = dateTime();
  return makeTimeRange(dateTime(now).subtract(DEFAULT_TIME_RANGE_HOURS, 'hours'), now);
}

function sortConversations(conversations: ConversationSearchResult[]): ConversationSearchResult[] {
  return [...conversations].sort((a, b) => Date.parse(b.last_generation_at) - Date.parse(a.last_generation_at));
}

async function fetchRangeConversations(
  dataSource: ConversationsDataSource,
  fromISO: string,
  toISO: string
): Promise<ConversationSearchResult[]> {
  let cursor = '';
  let hasMore = true;
  const conversations: ConversationSearchResult[] = [];

  while (hasMore) {
    const response = await dataSource.searchConversations({
      filters: '',
      select: DEFAULT_SEARCH_SELECT_FIELDS,
      time_range: {
        from: fromISO,
        to: toISO,
      },
      page_size: 100,
      cursor,
    });
    conversations.push(...(response.conversations ?? []));
    cursor = response.next_cursor ?? '';
    hasMore = Boolean(response.has_more && cursor.length > 0);
  }

  return conversations;
}

function buildConversationStats(conversations: ConversationSearchResult[], windowEndMs: number): ConversationStats {
  const totalConversations = conversations.length;
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  let totalLLMCalls = 0;
  let totalTokens = 0;
  let activeLast7d = 0;
  let ratedConversations = 0;
  let badRatedConversations = 0;

  for (const conversation of conversations) {
    totalLLMCalls += conversation.generation_count;
    const tokenValue = conversation.selected?.[TOTAL_TOKENS_SELECT_KEY];
    if (typeof tokenValue === 'number' && Number.isFinite(tokenValue)) {
      totalTokens += tokenValue;
    }
    const lastActivityTs = Date.parse(conversation.last_generation_at);
    if (Number.isFinite(lastActivityTs)) {
      const ageMs = windowEndMs - lastActivityTs;
      if (ageMs >= 0 && ageMs <= weekMs) {
        activeLast7d += 1;
      }
    }
    const ratingSummary = conversation.rating_summary;
    if (!ratingSummary || ratingSummary.total_count <= 0) {
      continue;
    }
    ratedConversations += 1;
    if (ratingSummary.has_bad_rating) {
      badRatedConversations += 1;
    }
  }

  const avgCallsPerConversation = totalConversations > 0 ? totalLLMCalls / totalConversations : 0;
  const badRatedPct = ratedConversations > 0 ? (badRatedConversations / ratedConversations) * 100 : 0;
  return { totalConversations, totalTokens, avgCallsPerConversation, activeLast7d, ratedConversations, badRatedPct };
}

function buildTrendLabel(
  currentValue: number,
  previousValue: number
): { direction: StatTrendDirection; label: string } | null {
  if (currentValue === previousValue) {
    return { direction: 'neutral', label: '→ 0%' };
  }
  if (previousValue === 0) {
    return null;
  }
  const percentageChange = ((currentValue - previousValue) / previousValue) * 100;
  if (percentageChange > 0) {
    return { direction: 'up', label: `↗ ${Math.abs(percentageChange).toFixed(1)}%` };
  }
  if (percentageChange < 0) {
    return { direction: 'down', label: `↘ ${Math.abs(percentageChange).toFixed(1)}%` };
  }
  return { direction: 'neutral', label: '→ 0%' };
}

function formatTrendComparisonValue(value: number, fractionDigits = 0, suffix = ''): string {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}${suffix}`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    label: 'conversationsBrowserPage-pageContainer',
    position: 'absolute',
    inset: 0,
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    gap: theme.spacing(1),
    minHeight: 0,
    overflow: 'hidden',
  }),
  summarySection: css({
    label: 'conversationsBrowserPage-summarySection',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: theme.spacing(0, 2, 0),
    boxShadow: 'inset 0 8px 8px -8px rgba(0, 0, 0, 0.22)',
    flex: '0 0 auto',
  }),
  controlsRow: css({
    label: 'conversationsBrowserPage-controlsRow',
    display: 'flex',
    justifyContent: 'flex-end',
    margin: theme.spacing(0.5, 0, 0, 0),
    width: '100%',
    padding: theme.spacing(1, 0),
    boxShadow: 'inset 0 10px 10px -10px rgba(0, 0, 0, 0.3)',
  }),
  statsGrid: css({
    label: 'conversationsBrowserPage-statsGrid',
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    width: '100%',
    gap: theme.spacing(0.5),
  }),
  statTile: css({
    label: 'conversationsBrowserPage-statTile',
    padding: theme.spacing(1.25, 1.5),
    minHeight: 84,
    minWidth: 180,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'flex-start',
    textAlign: 'left' as const,
  }),
  statLabel: css({
    label: 'conversationsBrowserPage-statLabel',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.25),
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
  }),
  statValue: css({
    label: 'conversationsBrowserPage-statValue',
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  statValueRow: css({
    label: 'conversationsBrowserPage-statValueRow',
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'flex-start',
    gap: theme.spacing(0.75),
    flexWrap: 'wrap' as const,
  }),
  statTrend: css({
    label: 'conversationsBrowserPage-statTrend',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  statTrendUp: css({
    label: 'conversationsBrowserPage-statTrendUp',
    color: theme.colors.success.main,
  }),
  statTrendDown: css({
    label: 'conversationsBrowserPage-statTrendDown',
    color: theme.colors.error.main,
  }),
  errorAlert: css({
    label: 'conversationsBrowserPage-errorAlert',
    margin: 0,
    border: 'none',
    borderBottom: `1px solid ${theme.colors.error.main}`,
    borderRadius: 0,
  }),
  layout: css({
    label: 'conversationsBrowserPage-layout',
    display: 'grid',
    gridTemplateColumns: 'minmax(340px, 1fr)',
    gap: theme.spacing(2),
    minHeight: 0,
    overflow: 'hidden',
  }),
  layoutWithSelection: css({
    label: 'conversationsBrowserPage-layoutWithSelection',
    gridTemplateColumns: 'minmax(320px, 0.8fr) minmax(520px, 1.4fr)',
    gap: theme.spacing(2),
    minHeight: 0,
    overflow: 'hidden',
  }),
  leftPanel: css({
    label: 'conversationsBrowserPage-leftPanel',
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  middlePanel: css({
    label: 'conversationsBrowserPage-middlePanel',
    minHeight: 0,
    overflow: 'hidden',
    minWidth: 0,
    width: '100%',
  }),
  detailPanel: css({
    label: 'conversationsBrowserPage-detailPanel',
    minHeight: 0,
    overflowY: 'auto' as const,
    minWidth: 0,
    width: '100%',
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    paddingLeft: theme.spacing(2),
  }),
  emptySelection: css({
    label: 'conversationsBrowserPage-emptySelection',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: theme.colors.text.secondary,
    padding: theme.spacing(2),
  }),
  detailPlaceholder: css({
    label: 'conversationsBrowserPage-detailPlaceholder',
    flex: 1,
    minHeight: 0,
    border: `1px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.colors.text.secondary,
    padding: theme.spacing(2),
  }),
  detailJson: css({
    label: 'conversationsBrowserPage-detailJson',
    margin: 0,
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  pageSpinner: css({
    label: 'conversationsBrowserPage-pageSpinner',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 280,
  }),
});

function serializeSpanToJSON(span: ConversationSpan): string {
  const attrs: Record<string, string> = {};
  for (const [key, value] of span.attributes) {
    if (value.stringValue !== undefined) {
      attrs[key] = value.stringValue;
    } else if (value.intValue !== undefined) {
      attrs[key] = value.intValue;
    } else if (value.doubleValue !== undefined) {
      attrs[key] = value.doubleValue;
    } else if (value.boolValue !== undefined) {
      attrs[key] = String(value.boolValue);
    }
  }
  return JSON.stringify(
    {
      traceID: span.traceID,
      spanID: span.spanID,
      parentSpanID: span.parentSpanID,
      name: span.name,
      kind: span.kind,
      serviceName: span.serviceName,
      startTimeUnixNano: span.startTimeUnixNano.toString(),
      endTimeUnixNano: span.endTimeUnixNano.toString(),
      durationNano: span.durationNano.toString(),
      attributes: attrs,
      generation: span.generation,
    },
    null,
    2
  );
}

export default function ConversationsBrowserPage(props: ConversationsBrowserPageProps) {
  const styles = useStyles2(getStyles);
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const traceFetcher = props.traceFetcher ?? defaultTraceFetcher;
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { conversationID: selectedConversationParam = '' } = useParams<{ conversationID?: string }>();
  const hasSelection = selectedConversationParam.length > 0;
  const conversationsSegment = `/${ROUTES.Conversations}`;
  const conversationsSegmentIndex = location.pathname.indexOf(conversationsSegment);
  const appBasePath = conversationsSegmentIndex >= 0 ? location.pathname.slice(0, conversationsSegmentIndex) : '';

  const buildAppPath = useCallback(
    (path: string): string => {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      return `${appBasePath}${normalizedPath}`;
    },
    [appBasePath]
  );

  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [previousConversations, setPreviousConversations] = useState<ConversationSearchResult[]>([]);
  const [conversationData, setConversationData] = useState<ConversationData | null>(null);
  const [conversationCosts, setConversationCosts] = useState<Map<string, GenerationCostResult>>(new Map());
  const [selectedConversationLoading, setSelectedConversationLoading] = useState<boolean>(false);
  const [selectedConversationErrorMessage, setSelectedConversationErrorMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [timeRange, setTimeRangeState] = useState<TimeRange>(() => defaultTimeRange());
  const requestVersionRef = useRef<number>(0);
  const selectedConversationRequestVersionRef = useRef<number>(0);

  const selectedSpanSelectionID = searchParams.get('span') ?? '';
  const selectedSpan = useMemo(() => {
    if (selectedSpanSelectionID.length === 0 || !conversationData) {
      return null;
    }
    return findSpanBySelectionID(conversationData.spans, selectedSpanSelectionID);
  }, [selectedSpanSelectionID, conversationData]);

  const loadConversations = useCallback(async (): Promise<void> => {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;
    setLoading(true);
    setErrorMessage('');
    try {
      const currentFromMs = timeRange.from.valueOf();
      const currentToMs = timeRange.to.valueOf();
      const windowMs = currentToMs - currentFromMs;
      const previousFromISO = dateTime(currentFromMs - windowMs).toISOString();
      const previousToISO = dateTime(currentToMs - windowMs).toISOString();
      const [results, previousRangeConversations] = await Promise.all([
        fetchRangeConversations(dataSource, timeRange.from.toISOString(), timeRange.to.toISOString()),
        fetchRangeConversations(dataSource, previousFromISO, previousToISO),
      ]);
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setConversations(sortConversations(results));
      setPreviousConversations(previousRangeConversations);
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
      setConversations([]);
      setPreviousConversations([]);
    } finally {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setLoading(false);
    }
  }, [dataSource, timeRange]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const resolvedSelectedConversationID = selectedConversationParam;
  const previousConversationIDRef = useRef<string>(resolvedSelectedConversationID);

  const selectedConversation = useMemo(() => {
    const selectedFromList = conversations.find(
      (conversation) => conversation.conversation_id === resolvedSelectedConversationID
    );
    if (selectedFromList) {
      return selectedFromList;
    }
    if (!conversationData || conversationData.conversationID !== resolvedSelectedConversationID) {
      return undefined;
    }
    return {
      conversation_id: conversationData.conversationID,
      generation_count: conversationData.generationCount,
      first_generation_at: conversationData.firstGenerationAt,
      last_generation_at: conversationData.lastGenerationAt,
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      rating_summary: conversationData.ratingSummary ?? undefined,
      annotation_count: conversationData.annotations.length,
    };
  }, [conversations, resolvedSelectedConversationID, conversationData]);
  const conversationStats = useMemo(
    () => buildConversationStats(conversations, timeRange.to.valueOf()),
    [conversations, timeRange]
  );
  const previousConversationStats = useMemo(
    () => buildConversationStats(previousConversations, timeRange.from.valueOf()),
    [previousConversations, timeRange]
  );

  const onMoveBackward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    setTimeRangeState(
      makeTimeRange(dateTime(timeRange.from.valueOf() - diff), dateTime(timeRange.to.valueOf() - diff))
    );
  }, [timeRange]);

  const onMoveForward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    setTimeRangeState(
      makeTimeRange(dateTime(timeRange.from.valueOf() + diff), dateTime(timeRange.to.valueOf() + diff))
    );
  }, [timeRange]);

  const onZoom = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    const half = Math.round(diff / 2);
    setTimeRangeState(
      makeTimeRange(dateTime(timeRange.from.valueOf() - half), dateTime(timeRange.to.valueOf() + half))
    );
  }, [timeRange]);

  const onSelectConversation = useCallback(
    (conversationID: string) => {
      if (conversationID.length === 0) {
        void navigate(buildAppPath(ROUTES.Conversations), { replace: true });
      } else {
        void navigate(buildAppPath(buildConversationViewRoute(conversationID)), { replace: true });
      }
    },
    [buildAppPath, navigate]
  );

  useEffect(() => {
    selectedConversationRequestVersionRef.current += 1;
    const requestVersion = selectedConversationRequestVersionRef.current;

    if (resolvedSelectedConversationID.length === 0) {
      setConversationData(null);
      setSelectedConversationLoading(false);
      setSelectedConversationErrorMessage('');
      return;
    }

    setSelectedConversationLoading(true);
    setSelectedConversationErrorMessage('');
    setConversationData(null);

    void loadConversationData(dataSource, resolvedSelectedConversationID, traceFetcher)
      .then((data) => {
        if (selectedConversationRequestVersionRef.current !== requestVersion) {
          return;
        }
        setConversationData(data);
      })
      .catch((error) => {
        if (selectedConversationRequestVersionRef.current !== requestVersion) {
          return;
        }
        setSelectedConversationErrorMessage(
          error instanceof Error ? error.message : 'failed to load conversation detail'
        );
      })
      .finally(() => {
        if (selectedConversationRequestVersionRef.current !== requestVersion) {
          return;
        }
        setSelectedConversationLoading(false);
      });
  }, [dataSource, resolvedSelectedConversationID, traceFetcher]);

  useEffect(() => {
    if (!conversationData) {
      setConversationCosts(new Map());
      return;
    }
    const gens = getAllGenerations(conversationData);
    if (gens.length === 0) {
      return;
    }
    void resolveGenerationCosts(gens, modelCardClient)
      .then(setConversationCosts)
      .catch(() => {
        setConversationCosts(new Map());
      });
  }, [conversationData, modelCardClient]);

  const tokenSummary = useMemo<TokenSummary | null>(() => {
    if (!conversationData) {
      return null;
    }
    return getTokenSummary(conversationData);
  }, [conversationData]);

  const costSummary = useMemo<CostSummary | null>(() => {
    if (conversationCosts.size === 0) {
      return null;
    }
    return getCostSummary(conversationCosts);
  }, [conversationCosts]);

  const modelCards = useMemo(() => {
    const cards = new Map<string, import('../modelcard/types').ModelCard>();
    for (const [, cost] of conversationCosts) {
      const key = `${cost.provider}::${cost.model}`;
      if (!cards.has(key)) {
        cards.set(key, cost.card);
      }
    }
    return cards;
  }, [conversationCosts]);

  useEffect(() => {
    if (previousConversationIDRef.current === resolvedSelectedConversationID) {
      return;
    }
    previousConversationIDRef.current = resolvedSelectedConversationID;

    const next = new URLSearchParams(location.search);
    if (!next.has('span') && !next.has('trace')) {
      return;
    }
    next.delete('span');
    next.delete('trace');
    setSearchParams(next, { replace: true });
  }, [location.search, resolvedSelectedConversationID, setSearchParams]);

  const onSelectSpan = useCallback(
    (span: ConversationSpan | null) => {
      const next = new URLSearchParams(searchParams);
      if (span == null) {
        next.delete('span');
        next.delete('trace');
      } else {
        next.set('span', getSelectionID(span));
        next.set('trace', span.traceID);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const selectedSpanDebugJSON = useMemo(() => {
    if (selectedSpan == null) {
      return '';
    }
    return serializeSpanToJSON(selectedSpan);
  }, [selectedSpan]);

  return (
    <div className={styles.pageContainer}>
      <div className={styles.summarySection}>
        <div className={styles.controlsRow}>
          <TimeRangePicker
            value={timeRange}
            onChange={setTimeRangeState}
            onChangeTimeZone={() => {}}
            onMoveBackward={onMoveBackward}
            onMoveForward={onMoveForward}
            onZoom={onZoom}
          />
        </div>
        <div className={styles.statsGrid}>
          <div className={styles.statTile}>
            <div className={styles.statLabel}>Conversations</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.totalConversations.toLocaleString()}</div>
              {(() => {
                const trend = buildTrendLabel(
                  conversationStats.totalConversations,
                  previousConversationStats.totalConversations
                );
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.totalConversations)}`}
                  >
                    {trend.label}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={styles.statTile}>
            <div className={styles.statLabel}>Tokens</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.totalTokens.toLocaleString()}</div>
              {(() => {
                const trend = buildTrendLabel(conversationStats.totalTokens, previousConversationStats.totalTokens);
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.totalTokens)}`}
                  >
                    {trend.label}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={styles.statTile}>
            <div className={styles.statLabel}>Avg Calls / Conversation</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.avgCallsPerConversation.toFixed(1)}</div>
              {(() => {
                const trend = buildTrendLabel(
                  conversationStats.avgCallsPerConversation,
                  previousConversationStats.avgCallsPerConversation
                );
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.avgCallsPerConversation, 1)}`}
                  >
                    {trend.label}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={styles.statTile}>
            <div className={styles.statLabel}>Active Conversations (7d)</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.activeLast7d.toLocaleString()}</div>
              {(() => {
                const trend = buildTrendLabel(conversationStats.activeLast7d, previousConversationStats.activeLast7d);
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.activeLast7d)}`}
                  >
                    {trend.label}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={styles.statTile}>
            <div className={styles.statLabel}>Rated Conversations</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.ratedConversations.toLocaleString()}</div>
              {(() => {
                const trend = buildTrendLabel(
                  conversationStats.ratedConversations,
                  previousConversationStats.ratedConversations
                );
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.ratedConversations)}`}
                  >
                    {trend.label}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={styles.statTile}>
            <div className={styles.statLabel}>Bad-Rated %</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.badRatedPct.toFixed(1)}%</div>
              {(() => {
                const trend = buildTrendLabel(conversationStats.badRatedPct, previousConversationStats.badRatedPct);
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.badRatedPct, 1, '%')}`}
                  >
                    {trend.label}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
        {errorMessage.length > 0 && (
          <Alert className={styles.errorAlert} severity="error" title="Conversation query failed">
            {errorMessage}
          </Alert>
        )}
      </div>

      <div className={`${styles.layout} ${hasSelection ? styles.layoutWithSelection : ''}`}>
        {!hasSelection && (
          <div className={styles.leftPanel}>
            <ConversationListPanel
              conversations={conversations}
              selectedConversationId={resolvedSelectedConversationID}
              loading={loading}
              hasMore={false}
              loadingMore={false}
              showExtendedColumns
              onSelectConversation={onSelectConversation}
              onLoadMore={() => undefined}
            />
          </div>
        )}

        {hasSelection && (
          <>
            <div className={styles.middlePanel}>
              {selectedConversationLoading ||
              (!selectedConversation && selectedConversationErrorMessage.length === 0) ? (
                <div className={styles.pageSpinner}>
                  <Spinner aria-label="loading selected conversation" />
                </div>
              ) : selectedConversationErrorMessage.length > 0 ? (
                <Alert severity="error" title="Conversation detail query failed">
                  {selectedConversationErrorMessage}
                </Alert>
              ) : (
                <ConversationColumn
                  conversation={selectedConversation!}
                  data={conversationData}
                  modelCards={modelCards}
                  tokenSummary={tokenSummary}
                  costSummary={costSummary}
                  loading={selectedConversationLoading}
                  errorMessage={selectedConversationErrorMessage}
                  selectedSpanSelectionID={selectedSpanSelectionID}
                  onSelectSpan={onSelectSpan}
                />
              )}
            </div>

            <div className={styles.detailPanel}>
              {selectedConversationLoading ? (
                <div className={styles.pageSpinner}>
                  <Spinner aria-label="loading conversation details" />
                </div>
              ) : selectedConversationErrorMessage.length > 0 ? (
                <div className={styles.detailPlaceholder}>Unable to load conversation details.</div>
              ) : selectedSpan != null ? (
                <pre className={styles.detailJson}>{selectedSpanDebugJSON}</pre>
              ) : (
                <div className={styles.detailPlaceholder}>Select a span to inspect raw JSON.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
