import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, makeTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Alert, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResult } from '../conversation/types';
import ConversationListPanel from '../components/conversations/ConversationListPanel';

type ActivityBucket = {
  key: string;
  label: string;
  count: number;
  conversationIDs: Set<string>;
};

type ChartViewMode = 'llm_calls' | 'time';
type TimeBucketUnit = 'hour' | 'day' | 'week' | 'month' | 'year';
type TimeBucketSpec = { unit: TimeBucketUnit; size: number };
type StatTrendDirection = 'up' | 'down' | 'neutral';

type ConversationStats = {
  totalConversations: number;
  totalLLMCalls: number;
  avgCallsPerConversation: number;
  activeLast7d: number;
  ratedConversations: number;
  badRatedPct: number;
};

const DEFAULT_TIME_RANGE_HOURS = 6;

function parseViewModeParam(value: string | null): ChartViewMode {
  if (value === 'time') {
    return 'time';
  }
  return 'llm_calls';
}

function defaultTimeRange(): TimeRange {
  const now = dateTime();
  return makeTimeRange(dateTime(now).subtract(DEFAULT_TIME_RANGE_HOURS, 'hours'), now);
}

function parseTimeParam(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const parsedNumber = Number(value);
    if (!Number.isFinite(parsedNumber)) {
      return null;
    }
    // Accept both Unix seconds and milliseconds.
    return value.length <= 10 ? parsedNumber * 1000 : parsedNumber;
  }
  const parsedDate = Date.parse(value);
  if (!Number.isFinite(parsedDate)) {
    return null;
  }
  return parsedDate;
}

function parseTimeRangeFromQuery(queryParams: URLSearchParams): TimeRange | null {
  const fromParam = queryParams.get('from');
  const toParam = queryParams.get('to');
  if (!fromParam || !toParam) {
    return null;
  }
  const fromMs = parseTimeParam(fromParam);
  const toMs = parseTimeParam(toParam);
  if (fromMs == null || toMs == null || toMs <= fromMs) {
    return null;
  }
  return makeTimeRange(dateTime(fromMs), dateTime(toMs));
}

function countLLMCallBuckets(maxCalls: number, step: number): number {
  if (step <= 0) {
    return 1;
  }
  return Math.floor(maxCalls / step) + 1;
}

function pickLLMCallBucketStep(maxCalls: number): number {
  if (maxCalls <= 0) {
    return 1;
  }
  const minBuckets = 10;
  const maxBuckets = 24;
  const targetBuckets = 16;
  const candidates = new Set<number>([1]);
  const maxExponent = Math.ceil(Math.log10(maxCalls + 1)) + 2;
  for (let exponent = 0; exponent <= maxExponent; exponent += 1) {
    const scale = Math.pow(10, exponent);
    candidates.add(1 * scale);
    candidates.add(2 * scale);
    candidates.add(5 * scale);
  }
  const scored = Array.from(candidates).map((step) => {
    const bucketCount = countLLMCallBuckets(maxCalls, step);
    const inRange = bucketCount >= minBuckets && bucketCount <= maxBuckets;
    const rangeDistance =
      bucketCount < minBuckets ? minBuckets - bucketCount : bucketCount > maxBuckets ? bucketCount - maxBuckets : 0;
    const targetDistance = Math.abs(bucketCount - targetBuckets);
    const score = (inRange ? 0 : 1000) + rangeDistance * 10 + targetDistance;
    return { step, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0].step;
}

function buildLLMCallBuckets(conversations: ConversationSearchResult[]): ActivityBucket[] {
  if (conversations.length === 0) {
    return [];
  }
  const maxCalls = conversations.reduce((max, item) => Math.max(max, item.generation_count), 0);
  const step = pickLLMCallBucketStep(maxCalls);
  const buckets: Array<ActivityBucket & { minCalls: number; maxCalls: number }> = [];
  const bucketByMinCalls = new Map<number, ActivityBucket & { minCalls: number; maxCalls: number }>();

  for (let minCalls = 0; minCalls <= maxCalls; minCalls += step) {
    const maxCallsForBucket = Math.min(minCalls + step - 1, maxCalls);
    const label = minCalls === maxCallsForBucket ? `${minCalls}` : `${minCalls}-${maxCallsForBucket}`;
    const bucket: ActivityBucket & { minCalls: number; maxCalls: number } = {
      key: `${minCalls}-${maxCallsForBucket}`,
      label,
      minCalls,
      maxCalls: maxCallsForBucket,
      count: 0,
      conversationIDs: new Set<string>(),
    };
    buckets.push(bucket);
    bucketByMinCalls.set(minCalls, bucket);
  }

  for (const conversation of conversations) {
    const bucketMinCalls = Math.floor(conversation.generation_count / step) * step;
    const bucket = bucketByMinCalls.get(bucketMinCalls);
    if (bucket == null) {
      continue;
    }
    bucket.count += 1;
    bucket.conversationIDs.add(conversation.conversation_id);
  }
  return buckets;
}

function startOfWeekUTC(ts: number): Date {
  const date = new Date(ts);
  const weekday = date.getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset));
}

function startOfBucketUTC(ts: number, spec: TimeBucketSpec): Date {
  const date = new Date(ts);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  if (spec.unit === 'hour') {
    const alignedHour = hour - (hour % spec.size);
    return new Date(Date.UTC(year, month, day, alignedHour, 0, 0, 0));
  }
  if (spec.unit === 'day') {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const dayStartMs = Date.UTC(year, month, day);
    const bucketMs = spec.size * DAY_MS;
    return new Date(Math.floor(dayStartMs / bucketMs) * bucketMs);
  }
  if (spec.unit === 'week') {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const anchorMondayMs = Date.UTC(1970, 0, 5);
    const weekStartMs = startOfWeekUTC(ts).getTime();
    const weeksSinceAnchor = Math.floor((weekStartMs - anchorMondayMs) / WEEK_MS);
    const alignedWeeks = Math.floor(weeksSinceAnchor / spec.size) * spec.size;
    return new Date(anchorMondayMs + alignedWeeks * WEEK_MS);
  }
  if (spec.unit === 'month') {
    const monthIndex = year * 12 + month;
    const alignedMonthIndex = Math.floor(monthIndex / spec.size) * spec.size;
    const alignedYear = Math.floor(alignedMonthIndex / 12);
    const alignedMonth = alignedMonthIndex % 12;
    return new Date(Date.UTC(alignedYear, alignedMonth, 1));
  }
  const alignedYear = Math.floor(year / spec.size) * spec.size;
  return new Date(Date.UTC(alignedYear, 0, 1));
}

function nextBucketStartUTC(date: Date, spec: TimeBucketSpec): Date {
  if (spec.unit === 'hour') {
    return new Date(date.getTime() + spec.size * 60 * 60 * 1000);
  }
  if (spec.unit === 'day') {
    return new Date(date.getTime() + spec.size * 24 * 60 * 60 * 1000);
  }
  if (spec.unit === 'week') {
    return new Date(date.getTime() + spec.size * 7 * 24 * 60 * 60 * 1000);
  }
  if (spec.unit === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + spec.size, 1));
  }
  return new Date(Date.UTC(date.getUTCFullYear() + spec.size, 0, 1));
}

function formatTimeBucketLabel(date: Date, spec: TimeBucketSpec): string {
  if (spec.unit === 'hour') {
    const startHour24 = date.getUTCHours();
    const startHour12 = startHour24 % 12 === 0 ? 12 : startHour24 % 12;
    const startSuffix = startHour24 < 12 ? 'am' : 'pm';
    return `${startHour12}${startSuffix}`;
  }
  if (spec.unit === 'day' || spec.unit === 'week') {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  if (spec.unit === 'year') {
    return `${date.getUTCFullYear()}`;
  }
  if (spec.unit === 'month') {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  return date.toISOString();
}

function countBucketsInRange(fromMs: number, toMs: number, spec: TimeBucketSpec): number {
  if (toMs <= fromMs) {
    return 1;
  }
  let count = 0;
  const maxIterations = 10000;
  const lastTs = Math.max(fromMs, toMs - 1);
  for (
    let cursor = startOfBucketUTC(fromMs, spec);
    cursor.getTime() <= lastTs && count < maxIterations;
    cursor = nextBucketStartUTC(cursor, spec)
  ) {
    count += 1;
  }
  return Math.max(count, 1);
}

function pickTimeBucketSpec(timeRange: TimeRange): TimeBucketSpec {
  const minBuckets = 10;
  const maxBuckets = 24;
  const targetBuckets = 16;
  const candidates: TimeBucketSpec[] = [
    { unit: 'hour', size: 1 },
    { unit: 'hour', size: 2 },
    { unit: 'hour', size: 3 },
    { unit: 'hour', size: 4 },
    { unit: 'hour', size: 6 },
    { unit: 'hour', size: 8 },
    { unit: 'hour', size: 12 },
    { unit: 'day', size: 1 },
    { unit: 'day', size: 2 },
    { unit: 'day', size: 3 },
    { unit: 'day', size: 5 },
    { unit: 'week', size: 1 },
    { unit: 'week', size: 2 },
    { unit: 'week', size: 4 },
    { unit: 'month', size: 1 },
    { unit: 'month', size: 2 },
    { unit: 'month', size: 3 },
    { unit: 'month', size: 6 },
    { unit: 'year', size: 1 },
    { unit: 'year', size: 2 },
    { unit: 'year', size: 5 },
  ];
  const fromMs = timeRange.from.valueOf();
  const toMs = timeRange.to.valueOf();
  const scored = candidates.map((candidate) => {
    const bucketCount = countBucketsInRange(fromMs, toMs, candidate);
    const inRange = bucketCount >= minBuckets && bucketCount <= maxBuckets;
    const rangeDistance =
      bucketCount < minBuckets ? minBuckets - bucketCount : bucketCount > maxBuckets ? bucketCount - maxBuckets : 0;
    const targetDistance = Math.abs(bucketCount - targetBuckets);
    const score = (inRange ? 0 : 1000) + rangeDistance * 10 + targetDistance;
    return { candidate, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0].candidate;
}

function buildTimeBuckets(conversations: ConversationSearchResult[], timeRange: TimeRange): ActivityBucket[] {
  const spec = pickTimeBucketSpec(timeRange);
  const fromMs = timeRange.from.valueOf();
  const toMs = timeRange.to.valueOf();
  const firstBucket = startOfBucketUTC(fromMs, spec);
  const lastBucket = startOfBucketUTC(Math.max(fromMs, toMs - 1), spec);
  const buckets: ActivityBucket[] = [];
  const bucketByKey = new Map<string, ActivityBucket>();

  for (
    let cursor = new Date(firstBucket);
    cursor.getTime() <= lastBucket.getTime();
    cursor = nextBucketStartUTC(cursor, spec)
  ) {
    const key = cursor.toISOString();
    const bucket: ActivityBucket = {
      key,
      label: formatTimeBucketLabel(cursor, spec),
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
    if (ts < fromMs || ts >= toMs) {
      continue;
    }
    const key = startOfBucketUTC(ts, spec).toISOString();
    const bucket = bucketByKey.get(key);
    if (!bucket) {
      continue;
    }
    bucket.count += 1;
    bucket.conversationIDs.add(conversation.conversation_id);
  }
  return buckets;
}

function buildConversationStats(conversations: ConversationSearchResult[], windowEndMs: number): ConversationStats {
  const totalConversations = conversations.length;
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  let totalLLMCalls = 0;
  let activeLast7d = 0;
  let ratedConversations = 0;
  let badRatedConversations = 0;

  for (const conversation of conversations) {
    totalLLMCalls += conversation.generation_count;

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

  return {
    totalConversations,
    totalLLMCalls,
    avgCallsPerConversation,
    activeLast7d,
    ratedConversations,
    badRatedPct,
  };
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
    label: 'conversationsListPage-pageContainer',
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  listContainer: css({
    label: 'conversationsListPage-listContainer',
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  }),
  chartPanel: css({
    label: 'conversationsListPage-chartPanel',
    minHeight: 240,
    margin: theme.spacing(0, 2),
    padding: theme.spacing(1.5),
  }),
  summarySection: css({
    label: 'conversationsListPage-summarySection',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: theme.spacing(0, 2),
    boxShadow: 'inset 0 8px 8px -8px rgba(0, 0, 0, 0.22)',
  }),
  controlsRow: css({
    label: 'conversationsListPage-controlsRow',
    display: 'flex',
    justifyContent: 'flex-end',
    margin: theme.spacing(0.5, 0, 0, 0),
    padding: theme.spacing(1, 0),
    boxShadow: 'inset 0 10px 10px -10px rgba(0, 0, 0, 0.3)',
  }),
  statsGrid: css({
    label: 'conversationsListPage-statsGrid',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 0,
  }),
  statTile: css({
    label: 'conversationsListPage-statTile',
    padding: theme.spacing(1.25, 1.5),
    minHeight: 84,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
  }),
  statLabel: css({
    label: 'conversationsListPage-statLabel',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.25),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  statValue: css({
    label: 'conversationsListPage-statValue',
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  statValueRow: css({
    label: 'conversationsListPage-statValueRow',
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.75),
    flexWrap: 'wrap' as const,
  }),
  chartTitle: css({
    label: 'conversationsListPage-chartTitle',
    marginBottom: theme.spacing(1.25),
  }),
  chartHeader: css({
    label: 'conversationsListPage-chartHeader',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: theme.spacing(1),
  }),
  chartSelect: css({
    label: 'conversationsListPage-chartSelect',
    border: 'none',
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.maxContrast,
    padding: theme.spacing(0, 0.75),
    height: theme.spacing(4),
    minHeight: theme.spacing(4),
    minWidth: 280,
    appearance: 'auto' as const,
    cursor: 'pointer',
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.2,
    '& option': {
      color: theme.colors.text.primary,
      background: theme.colors.background.primary,
    },
  }),
  chartBars: css({
    label: 'conversationsListPage-chartBars',
    display: 'flex',
    alignItems: 'end',
    gap: theme.spacing(0.75),
    overflowX: 'auto' as const,
    minHeight: 180,
    padding: theme.spacing(1),
    paddingBottom: theme.spacing(1.25),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
  }),
  chartBar: css({
    label: 'conversationsListPage-chartBar',
    color: theme.colors.text.primary,
    cursor: 'pointer',
    minWidth: 64,
    height: 160,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    border: 'none',
    background: 'transparent',
    padding: 0,
    flex: '0 0 auto',
    whiteSpace: 'normal' as const,
    textAlign: 'center' as const,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  chartBarActive: css({
    label: 'conversationsListPage-chartBarActive',
    '& > div:first-child': {
      opacity: 1,
      outline: `1px solid ${theme.colors.primary.main}`,
    },
  }),
  chartBarFill: css({
    label: 'conversationsListPage-chartBarFill',
    width: '100%',
    borderRadius: 2,
    background: theme.colors.primary.main,
    opacity: 0.85,
    minHeight: 4,
  }),
  chartBarMeta: css({
    label: 'conversationsListPage-chartBarMeta',
    marginTop: theme.spacing(0.5),
    lineHeight: 1.25,
    textAlign: 'left' as const,
  }),
  activityCount: css({
    label: 'conversationsListPage-activityCount',
    color: theme.colors.text.secondary,
    marginLeft: theme.spacing(0.5),
  }),
  statTrend: css({
    label: 'conversationsListPage-statTrend',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  statTrendUp: css({
    label: 'conversationsListPage-statTrendUp',
    color: theme.colors.success.main,
  }),
  statTrendDown: css({
    label: 'conversationsListPage-statTrendDown',
    color: theme.colors.error.main,
  }),
  errorAlert: css({
    label: 'conversationsListPage-errorAlert',
    margin: 0,
    border: 'none',
    borderBottom: `1px solid ${theme.colors.error.main}`,
    borderRadius: 0,
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
  const canUseRouterSearchParamUpdates = typeof Request !== 'undefined';
  const canUseWindowLocation = typeof window !== 'undefined';
  const [timeRange, setTimeRangeState] = useState<TimeRange>(() => {
    const initialQueryParams = canUseRouterSearchParamUpdates
      ? new URLSearchParams(searchParams)
      : new URLSearchParams(canUseWindowLocation ? window.location.search : '');
    return parseTimeRangeFromQuery(initialQueryParams) ?? defaultTimeRange();
  });

  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [previousConversations, setPreviousConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [fallbackViewMode, setFallbackViewMode] = useState<ChartViewMode>(parseViewModeParam(searchParams.get('view')));
  const [fallbackSelectedBucketKey, setFallbackSelectedBucketKey] = useState<string>(searchParams.get('bucket') ?? '');
  const requestVersionRef = useRef<number>(0);
  const viewMode = canUseRouterSearchParamUpdates ? parseViewModeParam(searchParams.get('view')) : fallbackViewMode;
  const selectedBucketKey = canUseRouterSearchParamUpdates
    ? (searchParams.get('bucket') ?? '')
    : fallbackSelectedBucketKey;
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
      setSearchParams(nextSearchParams);
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
      setSearchParams(nextSearchParams);
    },
    [canUseRouterSearchParamUpdates, searchParams, setSearchParams]
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

  useEffect(() => {
    if (!canUseRouterSearchParamUpdates && !canUseWindowLocation) {
      return;
    }
    const nextSearchParams = canUseRouterSearchParamUpdates
      ? new URLSearchParams(searchParams)
      : new URLSearchParams(window.location.search);
    const nextFromISO = timeRange.from.toISOString();
    const nextToISO = timeRange.to.toISOString();
    if (nextSearchParams.get('from') === nextFromISO && nextSearchParams.get('to') === nextToISO) {
      return;
    }
    nextSearchParams.set('from', nextFromISO);
    nextSearchParams.set('to', nextToISO);
    if (!canUseRouterSearchParamUpdates) {
      const nextQuery = nextSearchParams.toString();
      const nextURL = `${window.location.pathname}${nextQuery.length > 0 ? `?${nextQuery}` : ''}${window.location.hash}`;
      window.history.replaceState(window.history.state, '', nextURL);
      return;
    }
    setSearchParams(nextSearchParams, { replace: true });
  }, [canUseRouterSearchParamUpdates, canUseWindowLocation, searchParams, setSearchParams, timeRange]);

  const loadConversations = useCallback(async (): Promise<void> => {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;

    setLoading(true);
    setErrorMessage('');

    try {
      const pageSize = 50;
      const fetchRangeConversations = async (fromISO: string, toISO: string): Promise<ConversationSearchResult[]> => {
        let cursor = '';
        let hasMore = true;
        const allConversations: ConversationSearchResult[] = [];

        while (hasMore) {
          const response = await dataSource.searchConversations({
            filters: '',
            select: [],
            time_range: {
              from: fromISO,
              to: toISO,
            },
            page_size: pageSize,
            cursor,
          });
          allConversations.push(...(response.conversations ?? []));
          cursor = response.next_cursor ?? '';
          hasMore = Boolean(response.has_more && cursor.length > 0);
        }

        return allConversations;
      };

      const currentFromMs = timeRange.from.valueOf();
      const currentToMs = timeRange.to.valueOf();
      const windowMs = currentToMs - currentFromMs;
      const previousFromISO = dateTime(currentFromMs - windowMs).toISOString();
      const previousToISO = dateTime(currentToMs - windowMs).toISOString();

      const [allConversations, previousRangeConversations] = await Promise.all([
        fetchRangeConversations(timeRange.from.toISOString(), timeRange.to.toISOString()),
        fetchRangeConversations(previousFromISO, previousToISO),
      ]);

      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setConversations(allConversations);
      setPreviousConversations(previousRangeConversations);
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
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

  useEffect(() => {
    if (previousViewModeRef.current === viewMode) {
      return;
    }
    previousViewModeRef.current = viewMode;
    setSelectedBucketKey('');
  }, [setSelectedBucketKey, viewMode]);

  const activityBuckets = useMemo(
    () => (viewMode === 'time' ? buildTimeBuckets(conversations, timeRange) : buildLLMCallBuckets(conversations)),
    [conversations, timeRange, viewMode]
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
  const conversationStats = useMemo(() => {
    return buildConversationStats(conversations, timeRange.to.valueOf());
  }, [conversations, timeRange]);
  const previousConversationStats = useMemo(() => {
    return buildConversationStats(previousConversations, timeRange.from.valueOf());
  }, [previousConversations, timeRange]);

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
            <div className={styles.statLabel}>LLM Calls</div>
            <div className={styles.statValueRow}>
              <div className={styles.statValue}>{conversationStats.totalLLMCalls.toLocaleString()}</div>
              {(() => {
                const trend = buildTrendLabel(conversationStats.totalLLMCalls, previousConversationStats.totalLLMCalls);
                if (!trend) {
                  return null;
                }
                return (
                  <div
                    className={`${styles.statTrend} ${trend.direction === 'up' ? styles.statTrendUp : trend.direction === 'down' ? styles.statTrendDown : ''}`}
                    title={`Compared to previous window: ${formatTrendComparisonValue(previousConversationStats.totalLLMCalls)}`}
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
                  <div className={styles.chartBarFill} style={{ height: `${fillPercent}%` }} />
                  <div className={styles.chartBarMeta}>
                    <div>{bucket.label}</div>
                    <div className={styles.activityCount}>{bucket.count}</div>
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
            onSelectConversation={(conversationID) => navigate(`${encodeURIComponent(conversationID)}/detail`)}
            onLoadMore={() => undefined}
          />
        </div>
      )}
    </div>
  );
}
