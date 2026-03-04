import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentDetail, AgentVersionListItem } from '../agents/types';
import { PLUGIN_BASE, ROUTES } from '../constants';

const VERSION_PAGE_SIZE = 50;

export type AgentDetailPageProps = {
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
    padding: theme.spacing(2.5),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: `linear-gradient(150deg, ${theme.colors.background.secondary}, ${theme.colors.background.primary})`,
  }),
  heroHeader: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    flexWrap: 'wrap' as const,
  }),
  heroTitle: css({
    margin: 0,
    fontSize: theme.typography.size.xxl,
    lineHeight: 1.2,
    fontFamily: '"IBM Plex Serif", "Palatino Linotype", "Book Antiqua", Palatino, serif',
  }),
  warningBar: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.warning.border}`,
    background: theme.colors.warning.transparent,
    padding: theme.spacing(1),
  }),
  statsGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: theme.spacing(1),
  }),
  statCard: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.25),
  }),
  panel: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    padding: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  versionRow: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) auto auto',
    gap: theme.spacing(1),
    alignItems: 'center',
    [`@media (max-width: 900px)`]: {
      gridTemplateColumns: '1fr',
    },
  }),
  select: css({
    width: '100%',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    color: theme.colors.text.primary,
    padding: theme.spacing(1),
    fontSize: theme.typography.size.sm,
  }),
  codeBlock: css({
    margin: 0,
    maxHeight: 280,
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.25),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    lineHeight: 1.5,
  }),
  toolsGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: theme.spacing(1),
  }),
  toolCard: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
  }),
  modelList: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: theme.spacing(0.75),
  }),
  modelCard: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(3),
  }),
});

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'n/a';
  }
  return parsed.toLocaleString();
}

function buildAgentNameFromRoute(pathname: string, routeParam?: string): string {
  if (new RegExp(`(^|/)${ROUTES.Agents}/anonymous/?$`).test(pathname)) {
    return '';
  }
  return routeParam?.trim() ?? '';
}

export default function AgentDetailPage({ dataSource = defaultAgentsDataSource }: AgentDetailPageProps) {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ agentName: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [versions, setVersions] = useState<AgentVersionListItem[]>([]);
  const [versionsCursor, setVersionsCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const detailRequestVersion = useRef(0);
  const versionsRequestVersion = useRef(0);

  const selectedVersion = searchParams.get('version')?.trim() ?? '';
  const agentName = buildAgentNameFromRoute(location.pathname, params.agentName);
  const isAnonymous = agentName.length === 0;

  useEffect(() => {
    detailRequestVersion.current += 1;
    const version = detailRequestVersion.current;

    queueMicrotask(() => {
      if (detailRequestVersion.current !== version) {
        return;
      }
      setLoading(true);
      setErrorMessage('');
    });

    dataSource
      .lookupAgent(agentName, selectedVersion.length > 0 ? selectedVersion : undefined)
      .then((item) => {
        if (detailRequestVersion.current !== version) {
          return;
        }
        setDetail(item);
      })
      .catch((err) => {
        if (detailRequestVersion.current !== version) {
          return;
        }
        setDetail(null);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load agent detail');
      })
      .finally(() => {
        if (detailRequestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [agentName, dataSource, selectedVersion]);

  useEffect(() => {
    versionsRequestVersion.current += 1;
    const version = versionsRequestVersion.current;

    queueMicrotask(() => {
      if (versionsRequestVersion.current !== version) {
        return;
      }
      setLoadingVersions(true);
    });

    dataSource
      .listAgentVersions(agentName, VERSION_PAGE_SIZE)
      .then((response) => {
        if (versionsRequestVersion.current !== version) {
          return;
        }
        setVersions(response.items ?? []);
        setVersionsCursor(response.next_cursor ?? '');
      })
      .catch((err) => {
        if (versionsRequestVersion.current !== version) {
          return;
        }
        setVersions([]);
        setVersionsCursor('');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load versions');
      })
      .finally(() => {
        if (versionsRequestVersion.current !== version) {
          return;
        }
        setLoadingVersions(false);
      });
  }, [agentName, dataSource]);

  const versionOptions = useMemo(() => {
    const deduped = new Map<string, AgentVersionListItem>();
    for (const item of versions) {
      deduped.set(item.effective_version, item);
    }
    if (detail && !deduped.has(detail.effective_version)) {
      deduped.set(detail.effective_version, {
        effective_version: detail.effective_version,
        declared_version_first: detail.declared_version_first,
        declared_version_latest: detail.declared_version_latest,
        first_seen_at: detail.first_seen_at,
        last_seen_at: detail.last_seen_at,
        generation_count: detail.generation_count,
        tool_count: detail.tool_count,
        system_prompt_prefix: detail.system_prompt_prefix,
        token_estimate: detail.token_estimate,
      });
    }
    return Array.from(deduped.values()).sort((a, b) => {
      const t1 = Date.parse(a.last_seen_at);
      const t2 = Date.parse(b.last_seen_at);
      return t2 - t1;
    });
  }, [detail, versions]);

  const selectVersion = (nextVersion: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextVersion.trim().length === 0) {
      next.delete('version');
    } else {
      next.set('version', nextVersion);
    }
    setSearchParams(next, { replace: false });
  };

  const loadMoreVersions = async () => {
    if (loadingVersions || versionsCursor.length === 0) {
      return;
    }
    setLoadingVersions(true);
    try {
      const response = await dataSource.listAgentVersions(agentName, VERSION_PAGE_SIZE, versionsCursor);
      setVersions((prev) => [...prev, ...(response.items ?? [])]);
      setVersionsCursor(response.next_cursor ?? '');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load more versions');
    } finally {
      setLoadingVersions(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={styles.page}>
        <Alert severity="error" title="Agent not found">
          <Text>The selected agent detail could not be loaded.</Text>
        </Alert>
        <Button variant="secondary" onClick={() => navigate(`${PLUGIN_BASE}/${ROUTES.Agents}`)}>
          Back to agents
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.hero}>
        <div className={styles.heroHeader}>
          <div>
            <Text variant="bodySmall" color="secondary">
              Agent detail
            </Text>
            <h2 className={styles.heroTitle}>{isAnonymous ? 'Unnamed agent bucket' : detail.agent_name}</h2>
            <Stack direction="row" gap={1}>
              <Badge text={`Effective ${detail.effective_version.slice(0, 18)}...`} color="purple" />
              <Badge text={`${detail.generation_count.toLocaleString()} generations`} color="blue" />
            </Stack>
          </div>
          <Button variant="secondary" onClick={() => navigate(`${PLUGIN_BASE}/${ROUTES.Agents}`)}>
            Back to agents
          </Button>
        </div>

        {isAnonymous && (
          <div className={styles.warningBar}>
            <Text>
              This bucket aggregates generations where `gen_ai.agent.name` was missing. Treat versions here as diagnostic clusters.
            </Text>
          </div>
        )}

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <Text variant="bodySmall" color="secondary">
              Last seen
            </Text>
            <Text>{formatDate(detail.last_seen_at)}</Text>
          </div>
          <div className={styles.statCard}>
            <Text variant="bodySmall" color="secondary">
              First seen
            </Text>
            <Text>{formatDate(detail.first_seen_at)}</Text>
          </div>
          <div className={styles.statCard}>
            <Text variant="bodySmall" color="secondary">
              Tool count
            </Text>
            <Text>{detail.tool_count.toLocaleString()}</Text>
          </div>
          <div className={styles.statCard}>
            <Text variant="bodySmall" color="secondary">
              Token estimate
            </Text>
            <Text>{detail.token_estimate.total.toLocaleString()}</Text>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <Text element="h4">Version selector</Text>
        <div className={styles.versionRow}>
          <select
            aria-label="agent version selector"
            className={styles.select}
            value={selectedVersion.length > 0 ? selectedVersion : detail.effective_version}
            onChange={(event) => selectVersion(event.currentTarget.value)}
          >
            {versionOptions.map((version) => (
              <option key={version.effective_version} value={version.effective_version}>
                {version.effective_version.slice(0, 24)}... · {formatDate(version.last_seen_at)} · {version.generation_count.toLocaleString()} gen
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => selectVersion('')} disabled={selectedVersion.length === 0}>
            View latest
          </Button>
          <Button variant="secondary" onClick={() => void loadMoreVersions()} disabled={loadingVersions || versionsCursor.length === 0}>
            {loadingVersions ? 'Loading…' : 'Load more versions'}
          </Button>
        </div>
      </div>

      <div className={styles.panel}>
        <Text element="h4">System prompt</Text>
        <pre className={styles.codeBlock}>{detail.system_prompt.length > 0 ? detail.system_prompt : 'No system prompt recorded.'}</pre>
      </div>

      <div className={styles.panel}>
        <Text element="h4">Tools</Text>
        {detail.tools.length === 0 ? (
          <Text color="secondary">No tools captured for this version.</Text>
        ) : (
          <div className={styles.toolsGrid}>
            {detail.tools.map((tool) => (
              <div className={styles.toolCard} key={tool.name}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Text weight="medium">{tool.name}</Text>
                  <Badge text={`${tool.token_estimate.toLocaleString()} tok`} color="green" />
                </Stack>
                <Text variant="bodySmall" color="secondary">
                  {tool.type} · {tool.description || 'No description'}
                </Text>
                <pre className={styles.codeBlock}>{tool.input_schema_json || '{}'}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <Text element="h4">Model usage</Text>
        {detail.models.length === 0 ? (
          <Text color="secondary">No model usage rows available.</Text>
        ) : (
          <div className={styles.modelList}>
            {detail.models.map((model) => (
              <div key={`${model.provider}:${model.name}`} className={styles.modelCard}>
                <Text weight="medium">{model.provider} / {model.name}</Text>
                <Text variant="bodySmall" color="secondary">
                  {model.generation_count.toLocaleString()} generations
                </Text>
                <Text variant="bodySmall" color="secondary">
                  Last seen {formatDate(model.last_seen_at)}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
