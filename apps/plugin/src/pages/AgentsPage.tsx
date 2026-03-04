import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Input, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
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
  hero: css({
    position: 'relative' as const,
    overflow: 'hidden',
    padding: theme.spacing(3),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: `linear-gradient(145deg, ${theme.colors.background.primary}, ${theme.colors.background.secondary})`,
  }),
  heroGlow: css({
    position: 'absolute' as const,
    inset: -100,
    background:
      'radial-gradient(circle at 18% 18%, rgba(46, 134, 222, 0.25), transparent 44%), radial-gradient(circle at 82% 24%, rgba(248, 196, 113, 0.22), transparent 42%)',
    pointerEvents: 'none' as const,
  }),
  heroBody: css({
    position: 'relative' as const,
    zIndex: 1,
  }),
  heroTitle: css({
    letterSpacing: '0.02em',
    fontFamily: '"IBM Plex Serif", "Palatino Linotype", "Book Antiqua", Palatino, serif',
  }),
  statsRow: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: theme.spacing(1),
  }),
  statCard: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.5),
  }),
  searchRow: css({
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: theme.spacing(1),
    alignItems: 'end',
    [`@media (max-width: 768px)`]: {
      gridTemplateColumns: '1fr',
    },
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
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    padding: theme.spacing(1.5),
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: theme.shadows.z2,
      borderColor: theme.colors.border.medium,
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
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),
  cardTitle: css({
    margin: 0,
    fontSize: theme.typography.size.lg,
    lineHeight: 1.3,
    fontFamily: '"IBM Plex Serif", "Palatino Linotype", "Book Antiqua", Palatino, serif',
  }),
  keyValueGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(1),
  }),
  keyValueItem: css({
    borderTop: `1px dashed ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(0.75),
  }),
  footerRow: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing(1.25),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(3),
  }),
  center: css({
    display: 'flex',
    justifyContent: 'center',
  }),
});

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'n/a';
  }
  return parsed.toLocaleString();
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
      <div className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroBody}>
          <Text element="h2" className={styles.heroTitle}>
            Agents
          </Text>
          <Text color="secondary">Catalog of tenant agents with version health, prompt footprint, and tool surface.</Text>

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <Text variant="bodySmall" color="secondary">
                Loaded agents
              </Text>
              <Text element="h5">{summary.loadedAgents.toLocaleString()}</Text>
            </div>
            <div className={styles.statCard}>
              <Text variant="bodySmall" color="secondary">
                Named
              </Text>
              <Text element="h5">{summary.namedAgents.toLocaleString()}</Text>
            </div>
            <div className={styles.statCard}>
              <Text variant="bodySmall" color="secondary">
                Anonymous buckets
              </Text>
              <Text element="h5">{summary.anonymousCount.toLocaleString()}</Text>
            </div>
            <div className={styles.statCard}>
              <Text variant="bodySmall" color="secondary">
                Generations covered
              </Text>
              <Text element="h5">{summary.totalGenerations.toLocaleString()}</Text>
            </div>
          </div>
        </div>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.searchRow}>
        <Input
          prefix={<Badge text="Prefix" color="blue" />}
          value={searchInput}
          placeholder="Search by agent name prefix"
          onChange={(event) => setSearchInput(event.currentTarget.value)}
        />
        <Button variant="secondary" onClick={() => setSearchInput('')} disabled={searchInput.length === 0}>
          Clear
        </Button>
      </div>

      {loading ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Alert title="No agents found" severity="info">
          <Text>No agent matched this prefix in the current tenant.</Text>
        </Alert>
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
                    <h3 className={styles.cardTitle}>{isAnonymous ? 'Unnamed agent bucket' : item.agent_name}</h3>
                    <Badge text={isAnonymous ? 'Warning' : 'Tracked'} color={isAnonymous ? 'orange' : 'green'} />
                  </div>

                  <Text variant="bodySmall" color="secondary">
                    {isAnonymous
                      ? 'Generations missing `gen_ai.agent.name` are grouped here.'
                      : `Latest declared: ${item.latest_declared_version ?? 'n/a'}`}
                  </Text>

                  <div className={styles.keyValueGrid}>
                    <div className={styles.keyValueItem}>
                      <Text variant="bodySmall" color="secondary">
                        Last seen
                      </Text>
                      <Text>{formatDate(item.latest_seen_at)}</Text>
                    </div>
                    <div className={styles.keyValueItem}>
                      <Text variant="bodySmall" color="secondary">
                        First seen
                      </Text>
                      <Text>{formatDate(item.first_seen_at)}</Text>
                    </div>
                    <div className={styles.keyValueItem}>
                      <Text variant="bodySmall" color="secondary">
                        Versions
                      </Text>
                      <Text>{item.version_count.toLocaleString()}</Text>
                    </div>
                    <div className={styles.keyValueItem}>
                      <Text variant="bodySmall" color="secondary">
                        Tools
                      </Text>
                      <Text>{item.tool_count.toLocaleString()}</Text>
                    </div>
                  </div>

                  <div className={styles.footerRow}>
                    <Text variant="bodySmall" color="secondary">
                      Effective: {item.latest_effective_version.slice(0, 18)}...
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
