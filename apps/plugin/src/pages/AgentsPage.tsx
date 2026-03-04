import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import { dateTime, type GrafanaTheme2, makeTimeRange, type TimeRange } from '@grafana/data';
import { Alert, Icon, Input, Spinner, Stack, Text, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentListItem } from '../agents/types';
import { buildAgentDetailByNameRoute, buildAnonymousAgentDetailRoute, PLUGIN_BASE } from '../constants';
import { formatDateShort } from '../utils/date';

const PAGE_SIZE = 24;
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HIGH_CHURN_THRESHOLD = 5;
const HERO_TOP_LIMIT = 3;

export type AgentsPageProps = {
  dataSource?: AgentsDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  titleRow: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  searchRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  searchInput: css({
    flex: 1,
    maxWidth: 400,
  }),
  heroWrap: css({
    display: 'flex',
    justifyContent: 'center',
  }),
  hero: css({
    width: '100%',
    maxWidth: 1120,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  heroKpis: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: theme.spacing(1.5),
  }),
  heroKpiCard: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1.5),
    background: theme.colors.background.primary,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  heroKpiLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  heroKpiValue: css({
    fontSize: theme.typography.h3.fontSize,
    lineHeight: 1.1,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    fontVariantNumeric: 'tabular-nums',
  }),
  heroBody: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: theme.spacing(1.5),
    alignItems: 'start',
  }),
  heroSection: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1.5),
    background: theme.colors.background.primary,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  heroSectionTitle: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  rankList: css({
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
  }),
  rankItem: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  rankButton: css({
    padding: 0,
    border: 0,
    background: 'none',
    color: theme.colors.text.link,
    cursor: 'pointer',
    textAlign: 'left' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    '&:hover': {
      textDecoration: 'underline',
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: 2,
      borderRadius: theme.shape.radius.default,
    },
  }),
  rankValue: css({
    fontVariantNumeric: 'tabular-nums',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'nowrap' as const,
  }),
  riskList: css({
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: theme.spacing(1),
  }),
  riskItem: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
  }),
  riskValue: css({
    fontSize: theme.typography.h4.fontSize,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  riskLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  tableWrap: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflowX: 'auto',
    background: theme.colors.background.secondary,
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse' as const,
    minWidth: 880,
  }),
  th: css({
    textAlign: 'left' as const,
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap' as const,
  }),
  centeredColumn: css({
    textAlign: 'center' as const,
  }),
  tr: css({
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  }),
  anonymousRow: css({
    background: theme.colors.warning.transparent,
  }),
  td: css({
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    verticalAlign: 'top' as const,
    whiteSpace: 'nowrap' as const,
  }),
  promptCell: css({
    maxWidth: 360,
    whiteSpace: 'normal' as const,
    color: theme.colors.text.secondary,
  }),
  openButton: css({
    padding: 0,
    border: 0,
    background: 'none',
    color: theme.colors.text.link,
    cursor: 'pointer',
    textAlign: 'left' as const,
    '&:hover': {
      textDecoration: 'underline',
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: 2,
      borderRadius: theme.shape.radius.default,
    },
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  }),
  center: css({
    display: 'flex',
    justifyContent: 'center',
  }),
  loadMoreSentinel: css({
    height: 1,
  }),
  empty: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    color: theme.colors.text.disabled,
  }),
});

function cardLabel(item: AgentListItem): string {
  if (item.agent_name.trim().length > 0) {
    return item.agent_name;
  }
  return 'anonymous';
}

export default function AgentsPage({ dataSource = defaultAgentsDataSource }: AgentsPageProps) {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [items, setItems] = useState<AgentListItem[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const now = dateTime();
    return makeTimeRange(dateTime(now).subtract(24, 'hours'), now);
  });
  const requestVersion = useRef(0);
  const inFlightLoadMore = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setNamePrefix(searchInput.trim());
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    requestVersion.current += 1;
    const version = requestVersion.current;

    queueMicrotask(() => {
      if (requestVersion.current !== version) {
        return;
      }
      setLoading(true);
      setLoadingMore(false);
      inFlightLoadMore.current = false;
      setErrorMessage('');
    });

    dataSource
      .listAgents(PAGE_SIZE, '', namePrefix)
      .then((response) => {
        if (requestVersion.current !== version) {
          return;
        }
        setItems(response.items ?? []);
        setNextCursor(response.next_cursor ?? '');
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load agents');
        setItems([]);
        setNextCursor('');
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource, namePrefix]);

  const summary = useMemo(() => {
    const rangeFrom = timeRange.from.valueOf();
    const rangeTo = timeRange.to.valueOf();
    let anonymousCount = 0;
    let seenInRangeCount = 0;
    let staleCount = 0;
    let highChurnCount = 0;
    let totalGenerations = 0;
    let totalEstimatedTokens = 0;
    for (const item of items) {
      if (item.agent_name.trim() === '') {
        anonymousCount += 1;
      }
      const latestSeenAtMs = new Date(item.latest_seen_at).getTime();
      if (Number.isFinite(latestSeenAtMs)) {
        if (latestSeenAtMs >= rangeFrom && latestSeenAtMs <= rangeTo) {
          seenInRangeCount += 1;
        }
        if (rangeTo - latestSeenAtMs > STALE_WINDOW_MS) {
          staleCount += 1;
        }
      }
      if (item.version_count >= HIGH_CHURN_THRESHOLD) {
        highChurnCount += 1;
      }
      totalGenerations += item.generation_count;
      totalEstimatedTokens += item.token_estimate.total;
    }
    const topByGenerations = [...items]
      .sort((a, b) => b.generation_count - a.generation_count || cardLabel(a).localeCompare(cardLabel(b)))
      .slice(0, HERO_TOP_LIMIT);
    const topByTokenFootprint = [...items]
      .sort((a, b) => b.token_estimate.total - a.token_estimate.total || cardLabel(a).localeCompare(cardLabel(b)))
      .slice(0, HERO_TOP_LIMIT);
    return {
      loadedAgents: items.length,
      namedAgents: items.length - anonymousCount,
      anonymousCount,
      seenInRangeCount,
      staleCount,
      highChurnCount,
      totalGenerations,
      totalEstimatedTokens,
      averageTokensPerGeneration: totalGenerations > 0 ? Math.round(totalEstimatedTokens / totalGenerations) : 0,
      topByGenerations,
      topByTokenFootprint,
    };
  }, [items, timeRange]);

  const handleOpenAgent = (item: AgentListItem) => {
    const route =
      item.agent_name.trim().length > 0
        ? buildAgentDetailByNameRoute(item.agent_name)
        : buildAnonymousAgentDetailRoute();
    void navigate(`${PLUGIN_BASE}/${route}`);
  };

  const loadMore = useCallback(async () => {
    if (inFlightLoadMore.current || loadingMore || nextCursor.length === 0) {
      return;
    }
    inFlightLoadMore.current = true;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const response = await dataSource.listAgents(PAGE_SIZE, nextCursor, namePrefix);
      if (requestVersion.current !== version) {
        return;
      }
      setItems((prev) => [...prev, ...(response.items ?? [])]);
      setNextCursor(response.next_cursor ?? '');
    } catch (err) {
      if (requestVersion.current !== version) {
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load more agents');
    } finally {
      inFlightLoadMore.current = false;
      setLoadingMore(false);
    }
  }, [dataSource, loadingMore, namePrefix, nextCursor]);

  useEffect(() => {
    if (loading || loadingMore || nextCursor.length === 0 || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        void loadMore();
      },
      {
        root: null,
        // Start loading before the sentinel reaches the viewport edge.
        rootMargin: '200px 0px',
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, loading, loadingMore, nextCursor]);

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <div>
          <Text element="h2">Agents</Text>
          <Text color="secondary" variant="bodySmall">
            Catalog of tenant agents with version health, prompt footprint, and tool surface.
          </Text>
        </div>
        <TimeRangePicker
          value={timeRange}
          onChange={setTimeRange}
          onChangeTimeZone={() => {}}
          onMoveBackward={() => {
            const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
            const from = dateTime(timeRange.from.valueOf() - diff);
            const to = dateTime(timeRange.to.valueOf() - diff);
            setTimeRange({ from, to, raw: { from, to } });
          }}
          onMoveForward={() => {
            const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
            const from = dateTime(timeRange.from.valueOf() + diff);
            const to = dateTime(timeRange.to.valueOf() + diff);
            setTimeRange({ from, to, raw: { from, to } });
          }}
          onZoom={() => {
            const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
            const from = dateTime(timeRange.from.valueOf() - diff / 2);
            const to = dateTime(timeRange.to.valueOf() + diff / 2);
            setTimeRange({ from, to, raw: { from, to } });
          }}
          isOnCanvas
        />
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.searchRow}>
        <div className={styles.searchInput}>
          <Input
            prefix={<Icon name="search" />}
            suffix={
              searchInput.length > 0 ? (
                <Icon name="times" style={{ cursor: 'pointer' }} onClick={() => setSearchInput('')} />
              ) : undefined
            }
            value={searchInput}
            placeholder="Search by agent name…"
            onChange={(event: React.FormEvent<HTMLInputElement>) => setSearchInput(event.currentTarget.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="search" size="xl" />
          <Text color="secondary">No agents matched this search in the current tenant.</Text>
        </div>
      ) : (
        <>
          <div className={styles.heroWrap}>
            <section className={styles.hero} aria-label="agents hero summary">
              <div className={styles.heroKpis}>
                <div className={styles.heroKpiCard}>
                  <span className={styles.heroKpiLabel}>Seen in selected range</span>
                  <span className={styles.heroKpiValue}>{summary.seenInRangeCount.toLocaleString()}</span>
                </div>
                <div className={styles.heroKpiCard}>
                  <span className={styles.heroKpiLabel}>Total generations</span>
                  <span className={styles.heroKpiValue}>{summary.totalGenerations.toLocaleString()}</span>
                </div>
                <div className={styles.heroKpiCard}>
                  <span className={styles.heroKpiLabel}>Estimated prompt+tools tokens</span>
                  <span className={styles.heroKpiValue}>{summary.totalEstimatedTokens.toLocaleString()}</span>
                </div>
                <div className={styles.heroKpiCard}>
                  <span className={styles.heroKpiLabel}>Avg tokens per generation</span>
                  <span className={styles.heroKpiValue}>{summary.averageTokensPerGeneration.toLocaleString()}</span>
                </div>
              </div>

              <div className={styles.heroBody}>
                <div className={styles.heroSection}>
                  <Text element="h4" className={styles.heroSectionTitle}>
                    Top by generations
                  </Text>
                  <ul className={styles.rankList}>
                    {summary.topByGenerations.map((item) => (
                      <li key={`gen:${item.agent_name}:${item.latest_effective_version}`} className={styles.rankItem}>
                        <button
                          type="button"
                          className={styles.rankButton}
                          onClick={() => handleOpenAgent(item)}
                          aria-label={`open top generation agent ${cardLabel(item)}`}
                        >
                          {item.agent_name.trim().length > 0 ? item.agent_name : 'Unnamed agent bucket'}
                        </button>
                        <span className={styles.rankValue}>{item.generation_count.toLocaleString()} generations</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={styles.heroSection}>
                  <Text element="h4" className={styles.heroSectionTitle}>
                    Top by token footprint
                  </Text>
                  <ul className={styles.rankList}>
                    {summary.topByTokenFootprint.map((item) => (
                      <li key={`tok:${item.agent_name}:${item.latest_effective_version}`} className={styles.rankItem}>
                        <button
                          type="button"
                          className={styles.rankButton}
                          onClick={() => handleOpenAgent(item)}
                          aria-label={`open top token agent ${cardLabel(item)}`}
                        >
                          {item.agent_name.trim().length > 0 ? item.agent_name : 'Unnamed agent bucket'}
                        </button>
                        <span className={styles.rankValue}>{item.token_estimate.total.toLocaleString()} tokens</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={styles.heroSection}>
                  <Text element="h4" className={styles.heroSectionTitle}>
                    Risk and health
                  </Text>
                  <ul className={styles.riskList}>
                    <li className={styles.riskItem}>
                      <span className={styles.riskValue}>{summary.anonymousCount.toLocaleString()}</span>
                      <span className={styles.riskLabel}>anonymous buckets</span>
                    </li>
                    <li className={styles.riskItem}>
                      <span className={styles.riskValue}>{summary.staleCount.toLocaleString()}</span>
                      <span className={styles.riskLabel}>stale (&gt; 7 days)</span>
                    </li>
                    <li className={styles.riskItem}>
                      <span className={styles.riskValue}>{summary.highChurnCount.toLocaleString()}</span>
                      <span className={styles.riskLabel}>high churn ({HIGH_CHURN_THRESHOLD}+ versions)</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="agents index table">
              <thead>
                <tr>
                  <th className={styles.th}>Agent</th>
                  <th className={styles.th}>Latest seen</th>
                  <th className={cx(styles.th, styles.centeredColumn)}>Versions</th>
                  <th className={cx(styles.th, styles.centeredColumn)}>Tools</th>
                  <th className={cx(styles.th, styles.centeredColumn)}>Generations</th>
                  <th className={styles.th}>Prompt prefix</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isAnonymous = item.agent_name.trim().length === 0;
                  return (
                    <tr
                      key={`${item.agent_name}:${item.latest_effective_version}`}
                      className={cx(styles.tr, isAnonymous && styles.anonymousRow)}
                    >
                      <td className={styles.td}>
                        <button
                          type="button"
                          className={styles.openButton}
                          onClick={() => handleOpenAgent(item)}
                          aria-label={`open agent ${cardLabel(item)}`}
                        >
                          {isAnonymous ? 'Unnamed agent bucket' : item.agent_name}
                        </button>
                      </td>
                      <td className={styles.td}>{formatDateShort(item.latest_seen_at)}</td>
                      <td className={cx(styles.td, styles.centeredColumn)}>{item.version_count}</td>
                      <td className={cx(styles.td, styles.centeredColumn)}>{item.tool_count}</td>
                      <td className={cx(styles.td, styles.centeredColumn)}>{item.generation_count.toLocaleString()}</td>
                      <td className={cx(styles.td, styles.promptCell)}>
                        {item.system_prompt_prefix.length > 0 ? item.system_prompt_prefix : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {nextCursor.length > 0 && (
            <div className={styles.center}>
              <Stack direction="row" alignItems="center" gap={1}>
                {loadingMore && <Spinner size={18} />}
              </Stack>
              <div ref={loadMoreSentinelRef} className={styles.loadMoreSentinel} aria-hidden />
            </div>
          )}
        </>
      )}
    </div>
  );
}
