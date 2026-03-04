import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2 } from '@grafana/data';
import { Alert, useStyles2 } from '@grafana/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResult } from '../conversation/types';
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import type { DashboardFilters } from '../dashboard/types';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';
import { FilterToolbar } from '../components/filters/FilterToolbar';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import type { ModelCard } from '../modelcard/types';
import { resolveModelCardsFromNames } from '../modelcard/resolve';
import ConversationListPanel from '../components/conversations/ConversationListPanel';
import { ConversationTimelineHistogram } from '../components/conversations/ConversationTimelineHistogram';
import { buildConversationExploreRoute, ROUTES } from '../constants';

export type ConversationsBrowserPageProps = {
  dataSource?: ConversationsDataSource;
  dashboardDataSource?: DashboardDataSource;
  modelCardClient?: ModelCardClient;
};

const SDK_NAME_SELECT_KEY = 'span.sigil.sdk.name';
const TOTAL_TOKENS_SELECT_KEY = 'span.gen_ai.usage.total_tokens';
const DEFAULT_SEARCH_SELECT_FIELDS = [SDK_NAME_SELECT_KEY];

// Maps Prometheus metric labels to the backend's well-known filter short names
// which resolve to the correct Tempo span attributes (e.g. provider -> span.gen_ai.provider.name).
const promLabelToFilterKey: Record<string, string> = {
  gen_ai_provider_name: 'provider',
  gen_ai_request_model: 'model',
  gen_ai_agent_name: 'agent',
};

function buildFilterClause(key: string, values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    return `${key} = "${values[0]}"`;
  }
  return `${key} =~ "${values.join('|')}"`;
}

function buildConversationSearchFilter(filters: DashboardFilters): string {
  const parts: string[] = [];

  const providerClause = buildFilterClause('provider', filters.providers);
  if (providerClause) {
    parts.push(providerClause);
  }

  const modelClause = buildFilterClause('model', filters.models);
  if (modelClause) {
    parts.push(modelClause);
  }

  const agentClause = buildFilterClause('agent', filters.agentNames);
  if (agentClause) {
    parts.push(agentClause);
  }

  for (const lf of filters.labelFilters) {
    if (lf.key && lf.value) {
      const resolvedKey = promLabelToFilterKey[lf.key] ?? lf.key;
      parts.push(`${resolvedKey} ${lf.operator} "${lf.value}"`);
    }
  }
  return parts.join(' ');
}

type StatTrendDirection = 'up' | 'down' | 'neutral';
type ConversationStats = {
  totalConversations: number;
  totalTokens: number;
  avgCallsPerConversation: number;
  activeLast7d: number;
  ratedConversations: number;
  badRatedPct: number;
};

function sortConversations(conversations: ConversationSearchResult[]): ConversationSearchResult[] {
  return [...conversations].sort((a, b) => Date.parse(b.last_generation_at) - Date.parse(a.last_generation_at));
}

async function fetchRangeConversations(
  dataSource: ConversationsDataSource,
  fromISO: string,
  toISO: string,
  filterString: string
): Promise<ConversationSearchResult[]> {
  let cursor = '';
  let hasMore = true;
  const conversations: ConversationSearchResult[] = [];

  while (hasMore) {
    const response = await dataSource.searchConversations({
      filters: filterString,
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
  const weekMs = 7 * 24 * 60 * 60 * 1000;
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
    gridTemplateRows: 'auto auto minmax(0, 1fr)',
    gap: theme.spacing(1),
    minHeight: 0,
    overflow: 'hidden',
    overscrollBehavior: 'none' as const,
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
    margin: theme.spacing(0.5, 0, 0, 0),
    width: '100%',
    padding: theme.spacing(1, 0),
    boxShadow: 'inset 0 10px 10px -10px rgba(0, 0, 0, 0.3)',
  }),
  statsGrid: css({
    label: 'conversationsBrowserPage-statsGrid',
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    width: '100%',
    gap: theme.spacing(0.5),
  }),
  statTile: css({
    label: 'conversationsBrowserPage-statTile',
    padding: theme.spacing(1, 1.5),
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
  listPanel: css({
    label: 'conversationsBrowserPage-listPanel',
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  }),
});

export default function ConversationsBrowserPage(props: ConversationsBrowserPageProps) {
  const styles = useStyles2(getStyles);
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const dashboardDS = props.dashboardDataSource ?? defaultDashboardDataSource;
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;
  const location = useLocation();
  const navigate = useNavigate();

  const { timeRange, filters, setTimeRange, setFilters } = useFilterUrlState();

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);

  const { providerOptions, modelOptions, agentOptions, labelKeyOptions, labelsLoading } = useCascadingFilterOptions(
    dashboardDS,
    filters,
    from,
    to
  );

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
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const requestVersionRef = useRef<number>(0);

  const filterString = useMemo(() => buildConversationSearchFilter(filters), [filters]);

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
        fetchRangeConversations(dataSource, timeRange.from.toISOString(), timeRange.to.toISOString(), filterString),
        fetchRangeConversations(dataSource, previousFromISO, previousToISO, filterString),
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
  }, [dataSource, timeRange, filterString]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const conversationStats = useMemo(
    () => buildConversationStats(conversations, timeRange.to.valueOf()),
    [conversations, timeRange]
  );
  const previousConversationStats = useMemo(
    () => buildConversationStats(previousConversations, timeRange.from.valueOf()),
    [previousConversations, timeRange]
  );

  const [modelCards, setModelCards] = useState<Map<string, ModelCard>>(new Map());

  useEffect(() => {
    let stale = false;
    const allModels = Array.from(new Set(conversations.flatMap((c) => c.models)));
    if (allModels.length === 0) {
      setModelCards(new Map());
      return;
    }
    void resolveModelCardsFromNames(allModels, modelCardClient)
      .then((cards) => {
        if (!stale) {
          setModelCards(cards);
        }
      })
      .catch(() => {
        if (!stale) {
          setModelCards(new Map());
        }
      });
    return () => {
      stale = true;
    };
  }, [conversations, modelCardClient]);

  const getConversationHref = useCallback(
    (conversationID: string, conversationTitle?: string) => {
      const basePath = buildAppPath(buildConversationExploreRoute(conversationID));
      const normalizedTitle = conversationTitle?.trim() ?? '';
      if (normalizedTitle.length === 0) {
        return basePath;
      }
      const params = new URLSearchParams();
      params.set('conversationTitle', normalizedTitle);
      return `${basePath}?${params.toString()}`;
    },
    [buildAppPath]
  );

  const onSelectConversation = useCallback(
    (conversationID: string, conversationTitle?: string) => {
      void navigate(getConversationHref(conversationID, conversationTitle), { replace: true });
    },
    [getConversationHref, navigate]
  );

  return (
    <div className={styles.pageContainer}>
      <div className={styles.summarySection}>
        <div className={styles.controlsRow}>
          <FilterToolbar
            timeRange={timeRange}
            filters={filters}
            providerOptions={providerOptions}
            modelOptions={modelOptions}
            agentOptions={agentOptions}
            labelKeyOptions={labelKeyOptions}
            labelsLoading={labelsLoading}
            dataSource={dashboardDS}
            from={from}
            to={to}
            onTimeRangeChange={setTimeRange}
            onFiltersChange={setFilters}
            hideLabelFilters
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

      <ConversationTimelineHistogram conversations={conversations} timeRange={timeRange} loading={loading} />

      <div className={styles.listPanel}>
        <ConversationListPanel
          conversations={conversations}
          selectedConversationId=""
          loading={loading}
          hasMore={false}
          loadingMore={false}
          showExtendedColumns
          modelCards={modelCards}
          getConversationHref={getConversationHref}
          onSelectConversation={onSelectConversation}
          onLoadMore={() => undefined}
        />
      </div>
    </div>
  );
}
