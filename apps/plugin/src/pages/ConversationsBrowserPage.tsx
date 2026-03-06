import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2, type SelectableValue } from '@grafana/data';
import { Alert, Select, useStyles2 } from '@grafana/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { buildConversationSearchFilter } from '../conversation/filters';
import type { ConversationSearchResult, ConversationStatsResponse } from '../conversation/types';
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import { type ConversationOrderBy, conversationOrderByLabel, CONVERSATION_ORDER_BY_VALUES } from '../dashboard/types';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';
import { FilterToolbar } from '../components/filters/FilterToolbar';
import { TopStat } from '../components/TopStat';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import type { ModelCard } from '../modelcard/types';
import { resolveModelCardsFromNames } from '../modelcard/resolve';
import ConversationListPanel from '../components/conversations/ConversationListPanel';
import { ConversationTimelineHistogram } from '../components/conversations/ConversationTimelineHistogram';
import { buildConversationExploreRoute, ROUTES } from '../constants';
import { PageInsightBar } from '../components/insight/PageInsightBar';
import { isAbortError } from '../utils/http';

export type ConversationsBrowserPageProps = {
  dataSource?: ConversationsDataSource;
  dashboardDataSource?: DashboardDataSource;
  modelCardClient?: ModelCardClient;
};

const SDK_NAME_SELECT_KEY = 'span.sigil.sdk.name';
const INPUT_TOKENS_SELECT_KEY = 'span.gen_ai.usage.input_tokens';
const OUTPUT_TOKENS_SELECT_KEY = 'span.gen_ai.usage.output_tokens';
const DEFAULT_SEARCH_SELECT_FIELDS = [SDK_NAME_SELECT_KEY, INPUT_TOKENS_SELECT_KEY, OUTPUT_TOKENS_SELECT_KEY];

const orderByOptions: Array<SelectableValue<ConversationOrderBy>> = (
  Object.keys(conversationOrderByLabel) as ConversationOrderBy[]
).map((key) => ({ label: conversationOrderByLabel[key], value: key }));

function getConversationTotalTokens(conversation: ConversationSearchResult): number {
  const input = conversation.selected?.[INPUT_TOKENS_SELECT_KEY];
  const output = conversation.selected?.[OUTPUT_TOKENS_SELECT_KEY];
  const inputNum = typeof input === 'number' ? input : 0;
  const outputNum = typeof output === 'number' ? output : 0;
  return inputNum + outputNum;
}

type ConversationStats = ConversationStatsResponse;

const EMPTY_CONVERSATION_STATS: ConversationStats = {
  totalConversations: 0,
  totalTokens: 0,
  avgCallsPerConversation: 0,
  activeLast7d: 0,
  ratedConversations: 0,
  badRatedPct: 0,
};

function sortConversations(
  conversations: ConversationSearchResult[],
  orderBy: ConversationOrderBy = 'time'
): ConversationSearchResult[] {
  return [...conversations].sort((a, b) => {
    switch (orderBy) {
      case 'errors':
        return b.error_count - a.error_count;
      case 'duration': {
        const aDuration = Date.parse(a.last_generation_at) - Date.parse(a.first_generation_at);
        const bDuration = Date.parse(b.last_generation_at) - Date.parse(b.first_generation_at);
        return bDuration - aDuration;
      }
      case 'tokens':
        return getConversationTotalTokens(b) - getConversationTotalTokens(a);
      case 'time':
      default:
        return Date.parse(b.last_generation_at) - Date.parse(a.last_generation_at);
    }
  });
}

async function fetchRangeConversations(
  dataSource: ConversationsDataSource,
  fromISO: string,
  toISO: string,
  filterString: string,
  signal?: AbortSignal,
  onBatch?: (batch: ConversationSearchResult[]) => void
): Promise<ConversationSearchResult[]> {
  let cursor = '';
  const conversations: ConversationSearchResult[] = [];

  while (true) {
    signal?.throwIfAborted();
    const request = {
      filters: filterString,
      select: DEFAULT_SEARCH_SELECT_FIELDS,
      time_range: {
        from: fromISO,
        to: toISO,
      },
      page_size: 100,
      cursor,
    };

    if (dataSource.streamSearchConversations) {
      let nextCursor = '';
      let hasMore = false;
      await dataSource.streamSearchConversations(request, {
        signal,
        onResults(batch) {
          const safeBatch = batch ?? [];
          conversations.push(...safeBatch);
          onBatch?.(safeBatch);
        },
        onComplete(response) {
          nextCursor = response.next_cursor ?? '';
          hasMore = Boolean(response.has_more && nextCursor.length > 0);
        },
      });
      if (!hasMore) {
        break;
      }
      cursor = nextCursor;
      continue;
    }

    const response = await dataSource.searchConversations(request);
    const batch = response.conversations ?? [];
    conversations.push(...batch);
    onBatch?.(batch);
    cursor = response.next_cursor ?? '';
    if (!response.has_more || cursor.length === 0) {
      break;
    }
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
    totalTokens += getConversationTotalTokens(conversation);
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
    overscrollBehavior: 'none' as const,
  }),
  topSection: css({
    label: 'conversationsBrowserPage-topSection',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  insightRow: css({
    label: 'conversationsBrowserPage-insightRow',
  }),
  summarySection: css({
    label: 'conversationsBrowserPage-summarySection',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: 0,
    boxShadow: 'inset 0 8px 8px -8px rgba(0, 0, 0, 0.22)',
    flex: '0 0 auto',
  }),
  controlsRow: css({
    label: 'conversationsBrowserPage-controlsRow',
    margin: theme.spacing(0.5, 0, 0, 0),
    width: '100%',
    padding: theme.spacing(1, 2),
    boxShadow: 'inset 0 10px 10px -10px rgba(0, 0, 0, 0.3)',
  }),
  statsGrid: css({
    label: 'conversationsBrowserPage-statsGrid',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(4),
    padding: `${theme.spacing(1.5)} 20px`,
    minWidth: 0,
  }),
  progressRow: css({
    label: 'conversationsBrowserPage-progressRow',
    padding: theme.spacing(0, 0, 1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
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

  const { timeRange, filters, searchParams, setTimeRange, setFilters, setSearchParams } = useFilterUrlState();

  const orderBy = useMemo<ConversationOrderBy>(() => {
    const v = searchParams.get('orderBy') as ConversationOrderBy;
    return CONVERSATION_ORDER_BY_VALUES.has(v) ? v : 'time';
  }, [searchParams]);

  const setOrderBy = useCallback(
    (value: SelectableValue<ConversationOrderBy>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!value.value || value.value === 'time') {
            next.delete('orderBy');
          } else {
            next.set('orderBy', value.value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

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

  const [rawConversations, setRawConversations] = useState<ConversationSearchResult[]>([]);
  const [previousConversationStats, setPreviousConversationStats] =
    useState<ConversationStats>(EMPTY_CONVERSATION_STATS);
  const [loadingCurrent, setLoadingCurrent] = useState<boolean>(true);
  const [streamingCurrent, setStreamingCurrent] = useState<boolean>(true);
  const [loadingPrevious, setLoadingPrevious] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const requestVersionRef = useRef<number>(0);
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  const filterString = useMemo(() => buildConversationSearchFilter(filters), [filters]);

  const conversations = useMemo(() => sortConversations(rawConversations, orderBy), [rawConversations, orderBy]);

  const loadConversations = useCallback(async (): Promise<void> => {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;
    loadAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    loadAbortControllerRef.current = abortController;
    let releasePreviousStats: (() => void) | undefined;
    const previousStatsReady = new Promise<void>((resolve) => {
      releasePreviousStats = resolve;
    });
    setLoadingCurrent(true);
    setStreamingCurrent(true);
    setLoadingPrevious(true);
    setErrorMessage('');
    setRawConversations([]);
    setPreviousConversationStats(EMPTY_CONVERSATION_STATS);

    const currentFromMs = timeRange.from.valueOf();
    const currentToMs = timeRange.to.valueOf();
    const windowMs = currentToMs - currentFromMs;
    const previousFromISO = dateTime(currentFromMs - windowMs).toISOString();
    const previousToISO = dateTime(currentToMs - windowMs).toISOString();

    void (async () => {
      try {
        let sawBatch = false;
        const results = await fetchRangeConversations(
          dataSource,
          timeRange.from.toISOString(),
          timeRange.to.toISOString(),
          filterString,
          abortController.signal,
          (batch) => {
            if (requestVersionRef.current !== requestVersion || batch.length === 0) {
              return;
            }
            sawBatch = true;
            releasePreviousStats?.();
            releasePreviousStats = undefined;
            setRawConversations((current) => [...current, ...batch]);
            setLoadingCurrent(false);
          }
        );
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        if (!sawBatch) {
          setRawConversations(results);
        }
      } catch (error) {
        if (requestVersionRef.current !== requestVersion || isAbortError(error)) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
        setRawConversations([]);
      } finally {
        releasePreviousStats?.();
        releasePreviousStats = undefined;
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        if (loadAbortControllerRef.current === abortController) {
          loadAbortControllerRef.current = null;
        }
        setLoadingCurrent(false);
        setStreamingCurrent(false);
      }
    })();

    void (async () => {
      try {
        await previousStatsReady;
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const stats = dataSource.getConversationStats
          ? await dataSource.getConversationStats({
              filters: filterString,
              time_range: {
                from: previousFromISO,
                to: previousToISO,
              },
            })
          : buildConversationStats(
              await fetchRangeConversations(
                dataSource,
                previousFromISO,
                previousToISO,
                filterString,
                abortController.signal
              ),
              timeRange.from.valueOf()
            );
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setPreviousConversationStats(stats);
      } catch (error) {
        if (requestVersionRef.current !== requestVersion || isAbortError(error)) {
          return;
        }
        setErrorMessage((current) =>
          current.length > 0 ? current : error instanceof Error ? error.message : 'failed to load conversations'
        );
        setPreviousConversationStats(EMPTY_CONVERSATION_STATS);
      } finally {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setLoadingPrevious(false);
      }
    })();
  }, [dataSource, timeRange, filterString]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    return () => {
      loadAbortControllerRef.current?.abort();
    };
  }, []);

  const conversationStats = useMemo(
    () => buildConversationStats(conversations, timeRange.to.valueOf()),
    [conversations, timeRange]
  );

  const loadingDisplayedCurrentStats = loadingCurrent && conversations.length === 0;

  const loadedConversationCount = conversations.length;
  const currentConversationProgress = useMemo(() => {
    if (!streamingCurrent) {
      return '';
    }
    return `Loaded ${loadedConversationCount} conversations`;
  }, [loadedConversationCount, streamingCurrent]);

  const conversationInsightDataContext = useMemo(() => {
    if (loadingCurrent || streamingCurrent || loadingPrevious || conversations.length === 0) {
      return null;
    }
    const s = conversationStats;
    const p = previousConversationStats;
    const modelSet = new Set(conversations.flatMap((c) => c.models));
    const providerSet = new Set(conversations.flatMap((c) => Object.keys(c.model_providers ?? {})));
    const errCount = conversations.filter((c) => c.has_errors).length;
    return [
      `Conversations: ${s.totalConversations} (previous window: ${p.totalConversations})`,
      `Total tokens: ${s.totalTokens.toLocaleString()} (previous: ${p.totalTokens.toLocaleString()})`,
      `Avg calls per conversation: ${s.avgCallsPerConversation.toFixed(1)} (previous: ${p.avgCallsPerConversation.toFixed(1)})`,
      `Active conversations (7d): ${s.activeLast7d} (previous: ${p.activeLast7d})`,
      `Rated conversations: ${s.ratedConversations} (previous: ${p.ratedConversations})`,
      `Bad-rated %: ${s.badRatedPct.toFixed(1)}% (previous: ${p.badRatedPct.toFixed(1)}%)`,
      `Conversations with errors: ${errCount}`,
      `Unique models: ${[...modelSet].join(', ') || 'none'}`,
      `Unique providers: ${[...providerSet].join(', ') || 'none'}`,
    ].join('\n');
  }, [loadingCurrent, streamingCurrent, loadingPrevious, conversations, conversationStats, previousConversationStats]);

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
      <div className={styles.topSection}>
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
              fillWidth
            >
              <Select<ConversationOrderBy>
                options={orderByOptions}
                value={orderBy === 'time' ? null : orderBy}
                onChange={setOrderBy}
                placeholder="Order by"
                prefix={orderBy !== 'time' ? 'Order by' : undefined}
                width={28}
              />
            </FilterToolbar>
          </div>
          <div className={styles.statsGrid}>
            <TopStat
              label="Conversations"
              value={conversationStats.totalConversations}
              loading={loadingDisplayedCurrentStats}
              prevValue={previousConversationStats.totalConversations}
              prevLoading={loadingPrevious}
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Tokens"
              value={conversationStats.totalTokens}
              loading={loadingDisplayedCurrentStats}
              prevValue={previousConversationStats.totalTokens}
              prevLoading={loadingPrevious}
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Avg Calls / Conversation"
              value={conversationStats.avgCallsPerConversation}
              loading={loadingDisplayedCurrentStats}
              prevValue={previousConversationStats.avgCallsPerConversation}
              prevLoading={loadingPrevious}
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Active Conversations (7d)"
              value={conversationStats.activeLast7d}
              loading={loadingDisplayedCurrentStats}
              prevValue={previousConversationStats.activeLast7d}
              prevLoading={loadingPrevious}
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Rated Conversations"
              value={conversationStats.ratedConversations}
              loading={loadingDisplayedCurrentStats}
              prevValue={previousConversationStats.ratedConversations}
              prevLoading={loadingPrevious}
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Bad-Rated %"
              value={conversationStats.badRatedPct}
              unit="percent"
              loading={loadingDisplayedCurrentStats}
              prevValue={previousConversationStats.badRatedPct}
              prevLoading={loadingPrevious}
              invertChange
              comparisonLabel="in previous window"
            />
          </div>
          {currentConversationProgress.length > 0 && (
            <div className={styles.progressRow}>{currentConversationProgress}</div>
          )}
          {errorMessage.length > 0 && (
            <Alert className={styles.errorAlert} severity="error" title="Conversation query failed">
              {errorMessage}
            </Alert>
          )}
        </div>

        <div className={styles.insightRow}>
          <PageInsightBar
            prompt="Analyze these conversation metrics. Flag quality concerns, unusual patterns, or notable trends vs the previous period."
            origin="sigil-plugin/conversations-browser-insight"
            dataContext={conversationInsightDataContext}
          />
        </div>

        <ConversationTimelineHistogram
          conversations={conversations}
          timeRange={timeRange}
          loading={loadingCurrent}
          onTimeRangeChange={setTimeRange}
        />
      </div>

      <div className={styles.listPanel}>
        <ConversationListPanel
          conversations={conversations}
          selectedConversationId=""
          loading={loadingCurrent}
          hasMore={false}
          loadingMore={false}
          showExtendedColumns
          modelCards={modelCards}
          getConversationTokens={getConversationTotalTokens}
          getConversationHref={getConversationHref}
          onSelectConversation={onSelectConversation}
          onLoadMore={() => undefined}
        />
      </div>
    </div>
  );
}
