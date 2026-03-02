import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResult } from '../conversation/types';
import { buildConversationDetailRoute } from '../constants';
import ConversationListPanel from '../components/conversations/ConversationListPanel';

type ActivityBucket = {
  key: string;
  label: string;
  count: number;
  conversationIDs: Set<string>;
};

type ChartViewMode = 'llm_calls' | 'time';
type TimeBucketUnit = 'hour' | 'week' | 'month' | 'year';

function parseViewModeParam(value: string | null): ChartViewMode {
  if (value === 'time') {
    return 'time';
  }
  return 'llm_calls';
}

function buildLLMCallBuckets(conversations: ConversationSearchResult[]): ActivityBucket[] {
  if (conversations.length === 0) {
    return [];
  }

  const maxCalls = conversations.reduce((max, item) => Math.max(max, item.generation_count), 0);
  const bucketDefinitions: Array<{ minCalls: number; maxCalls?: number }> = [
    { minCalls: 0, maxCalls: 0 },
    { minCalls: 1, maxCalls: 1 },
    { minCalls: 2, maxCalls: 2 },
    { minCalls: 3, maxCalls: 3 },
    { minCalls: 4, maxCalls: 4 },
    { minCalls: 5, maxCalls: 5 },
    { minCalls: 6, maxCalls: 7 },
    { minCalls: 8, maxCalls: 9 },
    { minCalls: 10, maxCalls: 14 },
    { minCalls: 15, maxCalls: 19 },
    { minCalls: 20, maxCalls: 29 },
    { minCalls: 30, maxCalls: 39 },
    { minCalls: 40, maxCalls: 59 },
    { minCalls: 60, maxCalls: 79 },
    { minCalls: 80, maxCalls: 119 },
    { minCalls: 120, maxCalls: 199 },
    { minCalls: 200 },
  ];

  const buckets: Array<ActivityBucket & { minCalls: number; maxCalls?: number }> = bucketDefinitions
    .filter((definition) => {
      if (definition.maxCalls == null) {
        return maxCalls >= definition.minCalls;
      }
      return definition.minCalls <= maxCalls;
    })
    .map((definition) => {
      const maxCallsForLabel = definition.maxCalls;
      const label =
        maxCallsForLabel == null
          ? `${definition.minCalls}+`
          : definition.minCalls === maxCallsForLabel
            ? `${definition.minCalls}`
            : `${definition.minCalls}-${maxCallsForLabel}`;

      return {
        key: maxCallsForLabel == null ? `${definition.minCalls}-plus` : `${definition.minCalls}-${maxCallsForLabel}`,
        label,
        minCalls: definition.minCalls,
        maxCalls: maxCallsForLabel,
        count: 0,
        conversationIDs: new Set<string>(),
      };
    });

  for (const conversation of conversations) {
    const bucket = buckets.find((entry) => {
      if (entry.maxCalls == null) {
        return conversation.generation_count >= entry.minCalls;
      }
      return conversation.generation_count >= entry.minCalls && conversation.generation_count <= entry.maxCalls;
    });
    if (bucket == null) {
      continue;
    }
    bucket.count += 1;
    bucket.conversationIDs.add(conversation.conversation_id);
  }

  return buckets.filter((bucket) => bucket.count > 0);
}

function getTimeBucketUnit(conversations: ConversationSearchResult[]): TimeBucketUnit {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const timestamps = conversations
    .map((conversation) => Date.parse(conversation.last_generation_at))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) {
    return 'week';
  }
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const spanMs = maxTs - minTs;
  if (spanMs <= DAY_MS) {
    return 'hour';
  }
  const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);
  if (spanDays <= 365 * 2) {
    return 'week';
  }
  if (spanDays <= 365 * 8) {
    return 'month';
  }
  return 'year';
}

function startOfBucketUTC(ts: number, unit: TimeBucketUnit): Date {
  const date = new Date(ts);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  if (unit === 'hour') {
    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }
  if (unit === 'year') {
    return new Date(Date.UTC(year, 0, 1));
  }
  if (unit === 'month') {
    return new Date(Date.UTC(year, month, 1));
  }
  const weekday = date.getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return new Date(Date.UTC(year, month, day - mondayOffset));
}

function nextBucketStartUTC(date: Date, unit: TimeBucketUnit): Date {
  if (unit === 'hour') {
    return new Date(date.getTime() + 60 * 60 * 1000);
  }
  if (unit === 'year') {
    return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
  }
  if (unit === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }
  return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function startOfDayUTC(ts: number): Date {
  const date = new Date(ts);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function formatTimeBucketLabel(date: Date, unit: TimeBucketUnit): string {
  if (unit === 'hour') {
    const startHour24 = date.getUTCHours();
    const endHour24 = (startHour24 + 1) % 24;
    const startHour12 = startHour24 % 12 === 0 ? 12 : startHour24 % 12;
    const endHour12 = endHour24 % 12 === 0 ? 12 : endHour24 % 12;
    const startSuffix = startHour24 < 12 ? 'am' : 'pm';
    const endSuffix = endHour24 < 12 ? 'am' : 'pm';
    if (startSuffix === endSuffix) {
      return `${startHour12}-${endHour12}${endSuffix}`;
    }
    return `${startHour12}${startSuffix}-${endHour12}${endSuffix}`;
  }
  if (unit === 'year') {
    return `${date.getUTCFullYear()}`;
  }
  if (unit === 'month') {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function buildTimeBuckets(conversations: ConversationSearchResult[]): ActivityBucket[] {
  if (conversations.length === 0) {
    return [];
  }
  const unit = getTimeBucketUnit(conversations);
  const timestamps = conversations
    .map((conversation) => Date.parse(conversation.last_generation_at))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) {
    return [];
  }

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const firstBucket = unit === 'hour' ? startOfDayUTC(minTs) : startOfBucketUTC(minTs, unit);
  const lastBucket =
    unit === 'hour'
      ? new Date(startOfDayUTC(maxTs).getTime() + 23 * 60 * 60 * 1000)
      : startOfBucketUTC(maxTs, unit);
  const buckets: ActivityBucket[] = [];
  const bucketByKey = new Map<string, ActivityBucket>();

  for (let cursor = new Date(firstBucket); cursor.getTime() <= lastBucket.getTime(); cursor = nextBucketStartUTC(cursor, unit)) {
    const key = cursor.toISOString();
    const bucket: ActivityBucket = {
      key,
      label: formatTimeBucketLabel(cursor, unit),
      count: 0,
      conversationIDs: new Set<string>(),
    };
    bucketByKey.set(key, bucket);
    buckets.push(bucket);
  }

  for (const conversation of conversations) {
    const ts = Date.parse(conversation.last_generation_at);
    if (!Number.isFinite(ts)) {
      continue;
    }
    const key = startOfBucketUTC(ts, unit).toISOString();
    const bucket = bucketByKey.get(key);
    if (!bucket) {
      continue;
    }
    bucket.count += 1;
    bucket.conversationIDs.add(conversation.conversation_id);
  }

  if (unit === 'hour') {
    return buckets;
  }
  return buckets.filter((bucket) => bucket.count > 0);
}

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  listContainer: css({
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  }),
  chartPanel: css({
    minHeight: 240,
    margin: theme.spacing(0, 2),
    padding: theme.spacing(1.5),
  }),
  chartTitle: css({
    marginBottom: theme.spacing(1.25),
  }),
  chartHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: theme.spacing(1),
  }),
  chartSelect: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    padding: theme.spacing(0, 0.75),
    height: theme.spacing(4),
    minHeight: theme.spacing(4),
    appearance: 'auto' as const,
    cursor: 'pointer',
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.2,
  }),
  chartBars: css({
    display: 'flex',
    alignItems: 'end',
    gap: theme.spacing(0.75),
    overflowX: 'auto' as const,
    minHeight: 180,
    paddingBottom: theme.spacing(0.5),
  }),
  chartBar: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    minWidth: 64,
    height: 180,
    display: 'flex',
    alignItems: 'end',
    justifyContent: 'stretch',
    padding: theme.spacing(0.5),
    flex: '0 0 auto',
    whiteSpace: 'normal' as const,
    textAlign: 'center' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  chartBarActive: css({
    borderColor: theme.colors.primary.main,
    background: theme.colors.primary.transparent,
  }),
  chartBarContent: css({
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
  }),
  chartBarFillArea: css({
    flex: 1,
    display: 'flex',
    alignItems: 'end',
  }),
  chartBarFill: css({
    width: '100%',
    borderRadius: theme.shape.radius.default,
    background: theme.colors.primary.main,
    opacity: 0.85,
    minHeight: 4,
  }),
  chartBarMeta: css({
    marginTop: theme.spacing(0.5),
    lineHeight: 1.25,
  }),
  activityCount: css({
    color: theme.colors.text.secondary,
    marginLeft: theme.spacing(0.5),
  }),
});

export type ConversationsListPageProps = {
  dataSource?: ConversationsDataSource;
};

export default function ConversationsListPage(props: ConversationsListPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const styles = useStyles2(getStyles);

  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [fallbackViewMode, setFallbackViewMode] = useState<ChartViewMode>(parseViewModeParam(searchParams.get('view')));
  const [fallbackSelectedBucketKey, setFallbackSelectedBucketKey] = useState<string>(searchParams.get('bucket') ?? '');
  const requestVersionRef = useRef<number>(0);
  const canUseRouterSearchParamUpdates = typeof Request !== 'undefined';
  const viewMode = canUseRouterSearchParamUpdates ? parseViewModeParam(searchParams.get('view')) : fallbackViewMode;
  const selectedBucketKey = canUseRouterSearchParamUpdates ? (searchParams.get('bucket') ?? '') : fallbackSelectedBucketKey;
  const previousViewModeRef = useRef<ChartViewMode>(viewMode);

  const setViewMode = useCallback(
    (nextViewMode: ChartViewMode) => {
      const nextSearchParams = canUseRouterSearchParamUpdates
        ? new URLSearchParams(searchParams)
        : new URLSearchParams(window.location.search);
      if (!canUseRouterSearchParamUpdates) {
        setFallbackViewMode(nextViewMode);
        if (nextViewMode === 'llm_calls') {
          nextSearchParams.delete('view');
        } else {
          nextSearchParams.set('view', nextViewMode);
        }
        const nextQuery = nextSearchParams.toString();
        const nextURL = `${window.location.pathname}${nextQuery.length > 0 ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState(window.history.state, '', nextURL);
        return;
      }
      if (nextViewMode === 'llm_calls') {
        nextSearchParams.delete('view');
      } else {
        nextSearchParams.set('view', nextViewMode);
      }
      setSearchParams(nextSearchParams, { replace: true });
    },
    [canUseRouterSearchParamUpdates, searchParams, setSearchParams]
  );

  const setSelectedBucketKey = useCallback(
    (nextSelectionKey: string) => {
      const nextSearchParams = canUseRouterSearchParamUpdates
        ? new URLSearchParams(searchParams)
        : new URLSearchParams(window.location.search);
      if (!canUseRouterSearchParamUpdates) {
        setFallbackSelectedBucketKey(nextSelectionKey);
        if (nextSelectionKey.length === 0) {
          nextSearchParams.delete('bucket');
        } else {
          nextSearchParams.set('bucket', nextSelectionKey);
        }
        const nextQuery = nextSearchParams.toString();
        const nextURL = `${window.location.pathname}${nextQuery.length > 0 ? `?${nextQuery}` : ''}${window.location.hash}`;
        window.history.replaceState(window.history.state, '', nextURL);
        return;
      }
      if (nextSelectionKey.length === 0) {
        nextSearchParams.delete('bucket');
      } else {
        nextSearchParams.set('bucket', nextSelectionKey);
      }
      setSearchParams(nextSearchParams, { replace: true });
    },
    [canUseRouterSearchParamUpdates, searchParams, setSearchParams]
  );

  const loadConversations = useCallback(
    async (): Promise<void> => {
      requestVersionRef.current += 1;
      const requestVersion = requestVersionRef.current;

      setLoading(true);
      setErrorMessage('');

      try {
        if (dataSource.listConversations == null) {
          throw new Error('list conversations data source is not configured');
        }
        const response = await dataSource.listConversations();
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setConversations(
          (response?.items ?? []).map((item) => ({
            conversation_id: item.id,
            generation_count: item.generation_count,
            first_generation_at: item.created_at,
            last_generation_at: item.last_generation_at,
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            rating_summary: item.rating_summary,
            annotation_count: 0,
          }))
        );
      } catch (error) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
        setConversations([]);
      } finally {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setLoading(false);
      }
    },
    [dataSource]
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (previousViewModeRef.current === viewMode) {
      return;
    }
    previousViewModeRef.current = viewMode;
    setSelectedBucketKey('');
  }, [setSelectedBucketKey, viewMode]);

  const activityBuckets = useMemo(
    () => (viewMode === 'time' ? buildTimeBuckets(conversations) : buildLLMCallBuckets(conversations)),
    [conversations, viewMode]
  );

  useEffect(() => {
    if (loading) {
      return;
    }
    if (selectedBucketKey.length === 0) {
      return;
    }
    if (!activityBuckets.some((bucket) => bucket.key === selectedBucketKey)) {
      setSelectedBucketKey('');
    }
  }, [activityBuckets, loading, selectedBucketKey, setSelectedBucketKey]);

  const selectedBucket = useMemo(
    () => activityBuckets.find((bucket) => bucket.key === selectedBucketKey),
    [activityBuckets, selectedBucketKey]
  );

  const filteredConversations = useMemo(() => {
    if (!selectedBucket) {
      return [];
    }
    return conversations.filter((conversation) => selectedBucket.conversationIDs.has(conversation.conversation_id));
  }, [conversations, selectedBucket]);

  const maxBucketCount = useMemo(
    () => activityBuckets.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    [activityBuckets]
  );

  return (
    <div className={styles.pageContainer}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.chartPanel}>
        <div className={styles.chartTitle}>
          <div className={styles.chartHeader}>
            <select
              className={styles.chartSelect}
              value={viewMode}
              onChange={(event) => setViewMode(event.currentTarget.value as ChartViewMode)}
              aria-label="Conversation chart view"
            >
              <option value="llm_calls">Conversations by LLM calls</option>
              <option value="time">Conversations over time</option>
            </select>
          </div>
          <Text color="secondary">
            {viewMode === 'time'
              ? 'Click a bar to filter conversations for that week, month, or year.'
              : 'Click a bar to filter conversations by LLM calls bucket.'}
          </Text>
        </div>

        {activityBuckets.length > 0 && (
          <div className={styles.chartBars}>
            {activityBuckets.map((bucket) => {
              const active = selectedBucketKey === bucket.key;
              const fillPercent = maxBucketCount > 0 ? Math.max(2, (bucket.count / maxBucketCount) * 100) : 2;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  className={`${styles.chartBar} ${active ? styles.chartBarActive : ''}`}
                  onClick={() => setSelectedBucketKey(bucket.key)}
                  aria-pressed={active}
                  aria-label={
                    viewMode === 'time'
                      ? `Filter conversations for ${bucket.label}`
                      : `Filter conversations with ${bucket.label} LLM calls`
                  }
                >
                  <div className={styles.chartBarContent}>
                    <div className={styles.chartBarFillArea}>
                      <div className={styles.chartBarFill} style={{ height: `${fillPercent}%` }} />
                    </div>
                    <div className={styles.chartBarMeta}>
                      <div>{bucket.label}</div>
                      <div className={styles.activityCount}>{bucket.count}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

      </div>

      {(errorMessage.length === 0 || conversations.length > 0) && selectedBucket != null && (
        <div className={styles.listContainer}>
          <ConversationListPanel
            conversations={filteredConversations}
            selectedConversationId=""
            loading={loading}
            hasMore={false}
            loadingMore={false}
            onSelectConversation={(conversationID) => navigate(`/${buildConversationDetailRoute(conversationID)}`)}
            onLoadMore={() => undefined}
          />
        </div>
      )}
    </div>
  );
}
