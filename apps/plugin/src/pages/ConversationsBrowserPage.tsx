import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2, type SelectableValue } from '@grafana/data';
import { Alert, Select, useStyles2 } from '@grafana/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { getConversationPassRate } from '../conversation/aggregates';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { buildConversationSearchFilter } from '../conversation/filters';
import {
  canonicalizeConversationFilterKey,
  mapDashboardLabelFiltersToConversation,
} from '../conversation/filterKeyMapping';
import { buildConversationTagDiscoveryQuery } from '../conversation/searchTagScope';
import type { ConversationSearchResult, ConversationStatsResponse } from '../conversation/types';
import {
  type ConversationOrderBy,
  conversationOrderByLabel,
  CONVERSATION_ORDER_BY_VALUES,
  type DashboardFilters,
  type LabelFilter,
} from '../dashboard/types';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
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
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import { averageCost, calculateTotalCost } from '../dashboard/cost';
import { computeRangeDuration, tokensByModelAndTypeQuery } from '../dashboard/queries';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { useResolvedModelPricing } from '../components/dashboard/useResolvedModelPricing';
import { extractResolvePairs } from '../components/dashboard/dashboardShared';

export type ConversationsBrowserPageProps = {
  dataSource?: ConversationsDataSource;
  modelCardClient?: ModelCardClient;
  dashboardDataSource?: DashboardDataSource;
};

const INPUT_TOKENS_SELECT_KEY = 'span.gen_ai.usage.input_tokens';
const OUTPUT_TOKENS_SELECT_KEY = 'span.gen_ai.usage.output_tokens';
const CACHE_READ_TOKENS_SELECT_KEY = 'span.gen_ai.usage.cache_read_input_tokens';
const CACHE_WRITE_TOKENS_SELECT_KEY = 'span.gen_ai.usage.cache_write_input_tokens';
const REASONING_TOKENS_SELECT_KEY = 'span.gen_ai.usage.reasoning_tokens';
const DEFAULT_SEARCH_SELECT_FIELDS = [
  INPUT_TOKENS_SELECT_KEY,
  OUTPUT_TOKENS_SELECT_KEY,
  CACHE_READ_TOKENS_SELECT_KEY,
  CACHE_WRITE_TOKENS_SELECT_KEY,
  REASONING_TOKENS_SELECT_KEY,
];

const orderByOptions: Array<SelectableValue<ConversationOrderBy>> = (
  Object.keys(conversationOrderByLabel) as ConversationOrderBy[]
).map((key) => ({ label: conversationOrderByLabel[key], value: key }));

function getConversationTotalTokens(conversation: ConversationSearchResult): number {
  const input = conversation.selected?.[INPUT_TOKENS_SELECT_KEY];
  const output = conversation.selected?.[OUTPUT_TOKENS_SELECT_KEY];
  const cacheRead = conversation.selected?.[CACHE_READ_TOKENS_SELECT_KEY];
  const cacheWrite = conversation.selected?.[CACHE_WRITE_TOKENS_SELECT_KEY];
  const reasoning = conversation.selected?.[REASONING_TOKENS_SELECT_KEY];
  const inputNum = typeof input === 'number' ? input : 0;
  const outputNum = typeof output === 'number' ? output : 0;
  const cacheReadNum = typeof cacheRead === 'number' ? cacheRead : 0;
  const cacheWriteNum = typeof cacheWrite === 'number' ? cacheWrite : 0;
  const reasoningNum = typeof reasoning === 'number' ? reasoning : 0;
  return inputNum + outputNum + cacheReadNum + cacheWriteNum + reasoningNum;
}

type ConversationStats = ConversationStatsResponse;

const LABEL_FILTER_ROW_STORAGE_KEY = 'sigil.conversations.labelFilterRowOpen';
const DEDICATED_CONVERSATION_LABEL_KEYS = new Set([
  'span.gen_ai.provider.name',
  'span.gen_ai.request.model',
  'span.gen_ai.agent.name',
]);
const PROVIDER_TAG_KEY = 'span.gen_ai.provider.name';
const MODEL_TAG_KEY = 'span.gen_ai.request.model';
const AGENT_TAG_KEY = 'span.gen_ai.agent.name';

const EMPTY_CONVERSATION_STATS: ConversationStats = {
  totalConversations: 0,
  totalTokens: 0,
  avgCallsPerConversation: 0,
  activeLast7d: 0,
  ratedConversations: 0,
  badRatedPct: 0,
};

function conversationLabelPriority(label: string): number {
  if (label.startsWith('span.gen_ai.')) {
    return 0;
  }
  if (label.startsWith('resource.service.') || label.startsWith('resource.k8s.')) {
    return 1;
  }
  if (label.startsWith('span.')) {
    return 2;
  }
  if (label.startsWith('resource.')) {
    return 3;
  }
  return 4;
}

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
      case 'evals': {
        const aHasEvals = a.eval_summary && a.eval_summary.pass_count + a.eval_summary.fail_count > 0;
        const bHasEvals = b.eval_summary && b.eval_summary.pass_count + b.eval_summary.fail_count > 0;
        if (aHasEvals && !bHasEvals) {
          return -1;
        }
        if (!aHasEvals && bHasEvals) {
          return 1;
        }
        return (getConversationPassRate(a) ?? 1) - (getConversationPassRate(b) ?? 1);
      }
      case 'time':
      default:
        return Date.parse(b.last_generation_at) - Date.parse(a.last_generation_at);
    }
  });
}

function withConversationFilters(filters: DashboardFilters, overrides: Partial<DashboardFilters>): DashboardFilters {
  return {
    ...filters,
    ...overrides,
  };
}

function excludeConversationLabelFilter(filters: LabelFilter[], filter: LabelFilter): LabelFilter[] {
  let removed = false;

  return filters.filter((candidate) => {
    if (removed) {
      return true;
    }
    if (candidate.key === filter.key && candidate.operator === filter.operator && candidate.value === filter.value) {
      removed = true;
      return false;
    }
    return true;
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
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;
  const dashboardDataSource = props.dashboardDataSource ?? defaultDashboardDataSource;
  const location = useLocation();
  const navigate = useNavigate();

  const { timeRange, filters, searchParams, setTimeRange, setFilters, setSearchParams } = useFilterUrlState();
  const [showLabelFilterRow, setShowLabelFilterRow] = useState(() => {
    if (typeof window === 'undefined') {
      return filters.labelFilters.length > 0;
    }

    const storedValue = window.sessionStorage.getItem(LABEL_FILTER_ROW_STORAGE_KEY);
    if (storedValue === null) {
      return filters.labelFilters.length > 0;
    }

    return storedValue === '1';
  });
  const previousLabelFilterCountRef = useRef(filters.labelFilters.length);
  const conversationFilters = useMemo(
    () => ({
      ...filters,
      labelFilters: mapDashboardLabelFiltersToConversation(filters.labelFilters),
    }),
    [filters]
  );
  const [providerOptions, setProviderOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [conversationLabelKeyOptions, setConversationLabelKeyOptions] = useState<string[]>([]);
  const [conversationLabelsLoading, setConversationLabelsLoading] = useState(false);

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
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const windowSize = to - from;
  const previousFrom = from - windowSize;
  const previousTo = to - windowSize;
  const providerOptionsQuery = useMemo(
    () => buildConversationTagDiscoveryQuery(withConversationFilters(conversationFilters, { providers: [] })),
    [conversationFilters]
  );
  const modelOptionsQuery = useMemo(
    () => buildConversationTagDiscoveryQuery(withConversationFilters(conversationFilters, { models: [] })),
    [conversationFilters]
  );
  const agentOptionsQuery = useMemo(
    () => buildConversationTagDiscoveryQuery(withConversationFilters(conversationFilters, { agentNames: [] })),
    [conversationFilters]
  );
  const conversationTagDiscoveryQuery = useMemo(
    () => buildConversationTagDiscoveryQuery(conversationFilters),
    [conversationFilters]
  );

  useEffect(() => {
    const normalizedLabelFilters = conversationFilters.labelFilters;
    const rawLabelFilters = filters.labelFilters;

    if (rawLabelFilters.length === normalizedLabelFilters.length) {
      const isSame = rawLabelFilters.every((filter, index) => {
        const normalized = normalizedLabelFilters[index];
        return (
          normalized !== undefined &&
          filter.key === normalized.key &&
          filter.operator === normalized.operator &&
          filter.value === normalized.value
        );
      });
      if (isSame) {
        return;
      }
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('label');
        for (const lf of normalizedLabelFilters) {
          if (lf.key && lf.value) {
            next.append('label', `${lf.key}|${lf.operator}|${lf.value}`);
          }
        }
        return next;
      },
      { replace: true }
    );
  }, [conversationFilters.labelFilters, filters.labelFilters, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    const fromISO = timeRange.from.toISOString();
    const toISO = timeRange.to.toISOString();

    setConversationLabelsLoading(true);

    void dataSource
      .getSearchTags(fromISO, toISO, conversationTagDiscoveryQuery)
      .then((tags) => {
        if (cancelled) {
          return;
        }

        const nextOptions = tags
          .filter(
            (tag) =>
              (tag.scope === 'span' || tag.scope === 'resource') && !DEDICATED_CONVERSATION_LABEL_KEYS.has(tag.key)
          )
          .map((tag) => tag.key)
          .sort((left, right) => {
            const byPriority = conversationLabelPriority(left) - conversationLabelPriority(right);
            if (byPriority !== 0) {
              return byPriority;
            }
            return left.localeCompare(right);
          });

        setConversationLabelKeyOptions(nextOptions);
      })
      .catch(() => {
        if (!cancelled) {
          setConversationLabelKeyOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConversationLabelsLoading(false);
        }
      });

    void dataSource
      .getSearchTagValues(PROVIDER_TAG_KEY, fromISO, toISO, providerOptionsQuery)
      .then((values) => {
        if (!cancelled) {
          setProviderOptions(values);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviderOptions([]);
        }
      });

    void dataSource
      .getSearchTagValues(MODEL_TAG_KEY, fromISO, toISO, modelOptionsQuery)
      .then((values) => {
        if (!cancelled) {
          setModelOptions(values);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelOptions([]);
        }
      });

    void dataSource
      .getSearchTagValues(AGENT_TAG_KEY, fromISO, toISO, agentOptionsQuery)
      .then((values) => {
        if (!cancelled) {
          setAgentOptions(values);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    agentOptionsQuery,
    conversationTagDiscoveryQuery,
    dataSource,
    modelOptionsQuery,
    providerOptionsQuery,
    timeRange,
  ]);

  const loadConversationLabelValues = useCallback(
    async (filter: LabelFilter) => {
      const scopedFilters = withConversationFilters(conversationFilters, {
        labelFilters: excludeConversationLabelFilter(conversationFilters.labelFilters, filter),
      });
      const values = await dataSource.getSearchTagValues(
        canonicalizeConversationFilterKey(filter.key),
        timeRange.from.toISOString(),
        timeRange.to.toISOString(),
        buildConversationTagDiscoveryQuery(scopedFilters)
      );
      return values.map((value) => ({ label: value, value }));
    },
    [conversationFilters, dataSource, timeRange]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(LABEL_FILTER_ROW_STORAGE_KEY, showLabelFilterRow ? '1' : '0');
  }, [showLabelFilterRow]);

  useEffect(() => {
    const previousCount = previousLabelFilterCountRef.current;
    const nextCount = conversationFilters.labelFilters.length;

    if (previousCount === 0 && nextCount > 0) {
      setShowLabelFilterRow(true);
    }

    previousLabelFilterCountRef.current = nextCount;
  }, [conversationFilters.labelFilters]);

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
  const costTokens = usePrometheusQuery(
    dashboardDataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, 'none'),
    from,
    to,
    'instant'
  );
  const previousCostTokens = usePrometheusQuery(
    dashboardDataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, 'none'),
    previousFrom,
    previousTo,
    'instant'
  );
  const costResolvePairs = useMemo(
    () => [...extractResolvePairs(costTokens.data), ...extractResolvePairs(previousCostTokens.data)],
    [costTokens.data, previousCostTokens.data]
  );
  const resolvedPricing = useResolvedModelPricing(dashboardDataSource, costResolvePairs);
  const totalCost = useMemo(
    () => calculateTotalCost(costTokens.data ?? undefined, resolvedPricing.pricingMap),
    [costTokens.data, resolvedPricing.pricingMap]
  );
  const previousTotalCost = useMemo(
    () => calculateTotalCost(previousCostTokens.data ?? undefined, resolvedPricing.pricingMap),
    [previousCostTokens.data, resolvedPricing.pricingMap]
  );

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
  const currentCallCount = conversationStats.totalConversations * conversationStats.avgCallsPerConversation;
  const previousCallCount =
    previousConversationStats.totalConversations * previousConversationStats.avgCallsPerConversation;
  const averageCostPerConversation = averageCost(totalCost.totalCost, conversationStats.totalConversations);
  const previousAverageCostPerConversation = averageCost(
    previousTotalCost.totalCost,
    previousConversationStats.totalConversations
  );
  const averageCostPerCall = averageCost(totalCost.totalCost, currentCallCount);
  const previousAverageCostPerCall = averageCost(previousTotalCost.totalCost, previousCallCount);

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
      `Estimated cost: $${totalCost.totalCost.toFixed(4)} (previous: $${previousTotalCost.totalCost.toFixed(4)})`,
      `Avg cost per conversation: $${averageCostPerConversation.toFixed(4)} (previous: $${previousAverageCostPerConversation.toFixed(4)})`,
      `Avg cost per call: $${averageCostPerCall.toFixed(4)} (previous: $${previousAverageCostPerCall.toFixed(4)})`,
      `Total tokens: ${s.totalTokens.toLocaleString()} (previous: ${p.totalTokens.toLocaleString()})`,
      `Avg calls per conversation: ${s.avgCallsPerConversation.toFixed(1)} (previous: ${p.avgCallsPerConversation.toFixed(1)})`,
      `Active conversations (7d): ${s.activeLast7d} (previous: ${p.activeLast7d})`,
      `Rated conversations: ${s.ratedConversations} (previous: ${p.ratedConversations})`,
      `Bad-rated %: ${s.badRatedPct.toFixed(1)}% (previous: ${p.badRatedPct.toFixed(1)}%)`,
      `Conversations with errors: ${errCount}`,
      `Unique models: ${[...modelSet].join(', ') || 'none'}`,
      `Unique providers: ${[...providerSet].join(', ') || 'none'}`,
    ].join('\n');
  }, [
    averageCostPerCall,
    averageCostPerConversation,
    conversationStats,
    conversations,
    loadingCurrent,
    loadingPrevious,
    previousAverageCostPerCall,
    previousAverageCostPerConversation,
    previousConversationStats,
    previousTotalCost.totalCost,
    streamingCurrent,
    totalCost.totalCost,
  ]);

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
      void navigate(getConversationHref(conversationID, conversationTitle));
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
              filters={conversationFilters}
              providerOptions={providerOptions}
              modelOptions={modelOptions}
              agentOptions={agentOptions}
              labelKeyOptions={conversationLabelKeyOptions}
              labelsLoading={conversationLabelsLoading}
              from={from}
              to={to}
              loadLabelValues={loadConversationLabelValues}
              onTimeRangeChange={setTimeRange}
              onFiltersChange={setFilters}
              showLabelFilterRow={showLabelFilterRow}
              onLabelFilterRowOpenChange={setShowLabelFilterRow}
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
              label="Estimated Cost"
              value={totalCost.totalCost}
              unit="currencyUSD"
              loading={loadingDisplayedCurrentStats || costTokens.loading || resolvedPricing.loading}
              prevValue={previousTotalCost.totalCost}
              prevLoading={loadingPrevious || previousCostTokens.loading || resolvedPricing.loading}
              invertChange
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Avg Cost / Conversation"
              value={averageCostPerConversation}
              unit="currencyUSD"
              loading={loadingDisplayedCurrentStats || costTokens.loading || resolvedPricing.loading}
              prevValue={previousAverageCostPerConversation}
              prevLoading={loadingPrevious || previousCostTokens.loading || resolvedPricing.loading}
              invertChange
              comparisonLabel="in previous window"
            />
            <TopStat
              label="Avg Cost / Call"
              value={averageCostPerCall}
              unit="currencyUSD"
              loading={loadingDisplayedCurrentStats || costTokens.loading || resolvedPricing.loading}
              prevValue={previousAverageCostPerCall}
              prevLoading={loadingPrevious || previousCostTokens.loading || resolvedPricing.loading}
              invertChange
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
