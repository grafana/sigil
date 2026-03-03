import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, makeTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Alert, Spinner, Text, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResult } from '../conversation/types';
import ConversationColumn from '../components/conversations/ConversationColumn';
import ConversationListPanel from '../components/conversations/ConversationListPanel';

export type ConversationsBrowserPageProps = {
  dataSource?: ConversationsDataSource;
};

const SELECTED_CONVERSATION_PARAM = 'conversation';
const DEFAULT_TIME_RANGE_HOURS = 1;
const TOTAL_TOKENS_SELECT_KEY = 'span.gen_ai.usage.total_tokens';

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
      select: [TOTAL_TOKENS_SELECT_KEY],
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
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    height: '100%',
    gap: theme.spacing(1),
    minHeight: 0,
  }),
  summarySection: css({
    label: 'conversationsBrowserPage-summarySection',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    boxShadow: 'inset 0 8px 8px -8px rgba(0, 0, 0, 0.22)',
    flex: '0 0 auto',
  }),
  controlsRow: css({
    label: 'conversationsBrowserPage-controlsRow',
    display: 'flex',
    justifyContent: 'flex-end',
    margin: theme.spacing(0.5, 0, 0, 0),
    padding: theme.spacing(1, 0),
    boxShadow: 'inset 0 10px 10px -10px rgba(0, 0, 0, 0.3)',
  }),
  statsGrid: css({
    label: 'conversationsBrowserPage-statsGrid',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 0,
  }),
  statTile: css({
    label: 'conversationsBrowserPage-statTile',
    padding: theme.spacing(1.25, 1.5),
    minHeight: 84,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
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
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  layoutWithSelection: css({
    label: 'conversationsBrowserPage-layoutWithSelection',
    gridTemplateColumns: '20% minmax(320px, 0.8fr) minmax(520px, 1.4fr)',
    gap: theme.spacing(2),
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  leftPanel: css({
    label: 'conversationsBrowserPage-leftPanel',
    minHeight: 0,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  middlePanel: css({
    label: 'conversationsBrowserPage-middlePanel',
    minHeight: 0,
    overflowY: 'auto' as const,
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
  pageSpinner: css({
    label: 'conversationsBrowserPage-pageSpinner',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 280,
  }),
});

export default function ConversationsBrowserPage(props: ConversationsBrowserPageProps) {
  const styles = useStyles2(getStyles);
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const [searchParams, setSearchParams] = useSearchParams();

  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [previousConversations, setPreviousConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [timeRange, setTimeRangeState] = useState<TimeRange>(() => defaultTimeRange());
  const requestVersionRef = useRef<number>(0);

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

  const resolvedSelectedConversationID = useMemo(() => {
    const selectedConversationID = searchParams.get(SELECTED_CONVERSATION_PARAM) ?? '';
    if (selectedConversationID.length > 0 && conversations.some((item) => item.conversation_id === selectedConversationID)) {
      return selectedConversationID;
    }
    return '';
  }, [conversations, searchParams]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.conversation_id === resolvedSelectedConversationID),
    [conversations, resolvedSelectedConversationID]
  );
  const conversationStats = useMemo(() => buildConversationStats(conversations, timeRange.to.valueOf()), [conversations, timeRange]);
  const previousConversationStats = useMemo(
    () => buildConversationStats(previousConversations, timeRange.from.valueOf()),
    [previousConversations, timeRange]
  );

  const onMoveBackward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    setTimeRangeState(makeTimeRange(dateTime(timeRange.from.valueOf() - diff), dateTime(timeRange.to.valueOf() - diff)));
  }, [timeRange]);

  const onMoveForward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    setTimeRangeState(makeTimeRange(dateTime(timeRange.from.valueOf() + diff), dateTime(timeRange.to.valueOf() + diff)));
  }, [timeRange]);

  const onZoom = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    const half = Math.round(diff / 2);
    setTimeRangeState(makeTimeRange(dateTime(timeRange.from.valueOf() - half), dateTime(timeRange.to.valueOf() + half)));
  }, [timeRange]);

  const onSelectConversation = useCallback(
    (conversationID: string) => {
      const nextSearchParams = new URLSearchParams(searchParams);
      if (conversationID.length === 0) {
        nextSearchParams.delete(SELECTED_CONVERSATION_PARAM);
      } else {
        nextSearchParams.set(SELECTED_CONVERSATION_PARAM, conversationID);
      }
      setSearchParams(nextSearchParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

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
                const trend = buildTrendLabel(conversationStats.totalConversations, previousConversationStats.totalConversations);
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
                const trend = buildTrendLabel(conversationStats.ratedConversations, previousConversationStats.ratedConversations);
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

      <div className={`${styles.layout} ${selectedConversation ? styles.layoutWithSelection : ''}`}>
        <div className={styles.leftPanel}>
          <ConversationListPanel
            conversations={conversations}
            selectedConversationId={resolvedSelectedConversationID}
            loading={loading}
            hasMore={false}
            loadingMore={false}
            showExtendedColumns={!selectedConversation}
            onSelectConversation={onSelectConversation}
            onLoadMore={() => undefined}
          />
        </div>

        {selectedConversation && (
          <>
            <div className={styles.middlePanel}>
              {loading ? (
                <div className={styles.pageSpinner}>
                  <Spinner aria-label="loading selected conversation" />
                </div>
              ) : (
                <ConversationColumn conversation={selectedConversation} />
              )}
            </div>

            <div className={styles.detailPanel}>
              {loading ? (
                <div className={styles.pageSpinner}>
                  <Spinner aria-label="loading conversation details" />
                </div>
              ) : (
                <div className={styles.detailPlaceholder}>Conversation details panel coming soon.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
