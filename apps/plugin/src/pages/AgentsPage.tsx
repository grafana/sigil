import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Icon, Input, Spinner, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentListItem } from '../agents/types';
import { buildAgentDetailByNameRoute, buildAnonymousAgentDetailRoute, PLUGIN_BASE } from '../constants';

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
  cardsGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: theme.spacing(1.5),
  }),
  card: css({
    width: '100%',
    textAlign: 'left' as const,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    padding: theme.spacing(1.5),
    cursor: 'pointer',
    minHeight: '120px',
    display: 'flex',
    flexDirection: 'column' as const,
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
    '&:hover': {
      borderColor: theme.colors.primary.border,
      boxShadow: theme.shadows.z1,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: 2,
    },
  }),
  anonymousCard: css({
    borderColor: theme.colors.warning.border,
    background: `linear-gradient(160deg, ${theme.colors.warning.transparent}, ${theme.colors.background.secondary})`,
  }),
  cardHeader: css({
    marginBottom: theme.spacing(0.75),
  }),
  cardDescription: css({
    flex: 1,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    marginBottom: theme.spacing(1),
  }),
  cardFooter: css({
    marginTop: 'auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing(0.75),
    borderTop: `1px solid ${theme.colors.border.weak}`,
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

function formatDateShort(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'n/a';
  }
  return parsed.toLocaleDateString();
}

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
    const route = item.agent_name.trim().length > 0 ? buildAgentDetailByNameRoute(item.agent_name) : buildAnonymousAgentDetailRoute();
    void navigate(`${PLUGIN_BASE}/${route}`);
  };

  const loadMore = async () => {
    if (loadingMore || nextCursor.length === 0) {
      return;
    }
    setLoadingMore(true);
    try {
      const response = await dataSource.listAgents(PAGE_SIZE, nextCursor, namePrefix);
      setItems((prev) => [...prev, ...(response.items ?? [])]);
      setNextCursor(response.next_cursor ?? '');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load more agents');
    } finally {
      setLoadingMore(false);
    }
  };

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
            suffix={searchInput.length > 0 ? <Icon name="times" style={{ cursor: 'pointer' }} onClick={() => setSearchInput('')} /> : undefined}
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
          <div className={styles.cardsGrid}>
            {items.map((item) => {
              const isAnonymous = item.agent_name.trim().length === 0;
              return (
                <button
                  key={`${item.agent_name}:${item.latest_effective_version}`}
                  type="button"
                  className={cx(styles.card, isAnonymous && styles.anonymousCard)}
                  onClick={() => handleOpenAgent(item)}
                  aria-label={`open agent ${cardLabel(item)}`}
                >
                  <div className={styles.cardHeader}>
                    <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
                      <Text weight="medium">{isAnonymous ? 'Unnamed agent bucket' : item.agent_name}</Text>
                      <Badge text={isAnonymous ? 'Anonymous' : 'Named'} color={isAnonymous ? 'orange' : 'green'} />
                    </Stack>
                  </div>

                  {item.system_prompt_prefix.length > 0 && (
                    <div className={styles.cardDescription}>
                      <Text variant="bodySmall" color="secondary">
                        {item.system_prompt_prefix}
                      </Text>
                    </div>
                  )}

                  <div className={styles.cardFooter}>
                    <Text variant="bodySmall" color="secondary">
                      {formatDateShort(item.latest_seen_at)} · {item.version_count} ver · {item.tool_count} tools
                    </Text>
                    <Badge text={`${item.generation_count.toLocaleString()} gen`} color="purple" />
                  </div>
                </button>
              );
            })}
          </div>

          {nextCursor.length > 0 && (
            <div className={styles.center}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                  Load more
                </Button>
                {loadingMore && <Spinner size={18} />}
              </Stack>
            </div>
          )}
        </>
      )}
    </div>
  );
}
