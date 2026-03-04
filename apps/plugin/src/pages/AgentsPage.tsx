import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, Input, Spinner, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentListItem } from '../agents/types';
import { buildAgentDetailByNameRoute, buildAnonymousAgentDetailRoute, PLUGIN_BASE } from '../constants';
import { formatDateShort } from '../utils/date';

const PAGE_SIZE = 24;

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
    alignItems: 'flex-end',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  statsRow: css({
    display: 'flex',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  statItem: css({
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.5),
  }),
  statValue: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  }),
  statLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
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
    let anonymousCount = 0;
    let totalGenerations = 0;
    for (const item of items) {
      if (item.agent_name.trim() === '') {
        anonymousCount += 1;
      }
      totalGenerations += item.generation_count;
    }
    return {
      loadedAgents: items.length,
      namedAgents: items.length - anonymousCount,
      anonymousCount,
      totalGenerations,
    };
  }, [items]);

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
        {!loading && items.length > 0 && (
          <div className={styles.statsRow}>
            <Tooltip content="Total agents returned in the current page or search">
              <div className={styles.statItem}>
                <span className={styles.statValue}>{summary.loadedAgents}</span>
                <span className={styles.statLabel}>agents</span>
              </div>
            </Tooltip>
            <Tooltip content="Agents with an explicit name set">
              <div className={styles.statItem}>
                <span className={styles.statValue}>{summary.namedAgents}</span>
                <span className={styles.statLabel}>named</span>
              </div>
            </Tooltip>
            <Tooltip content="Agents without a name, grouped under a shared bucket">
              <div className={styles.statItem}>
                <span className={styles.statValue}>{summary.anonymousCount}</span>
                <span className={styles.statLabel}>anonymous</span>
              </div>
            </Tooltip>
            <Tooltip content="Total LLM generations across all visible agents">
              <div className={styles.statItem}>
                <span className={styles.statValue}>{summary.totalGenerations.toLocaleString()}</span>
                <span className={styles.statLabel}>generations</span>
              </div>
            </Tooltip>
          </div>
        )}
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
            onChange={(event) => setSearchInput(event.currentTarget.value)}
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
          <Text color="secondary">No agents matched this prefix in the current tenant.</Text>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="agents index table">
              <thead>
                <tr>
                  <th className={styles.th}>Agent</th>
                  <th className={styles.th}>Latest seen</th>
                  <th className={styles.th}>Versions</th>
                  <th className={styles.th}>Tools</th>
                  <th className={styles.th}>Generations</th>
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
                      <td className={styles.td}>{item.version_count}</td>
                      <td className={styles.td}>{item.tool_count}</td>
                      <td className={styles.td}>{item.generation_count.toLocaleString()}</td>
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
