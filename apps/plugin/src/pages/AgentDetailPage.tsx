import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Icon, Select, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentDetail, AgentRatingResponse, AgentVersionListItem } from '../agents/types';
import ModelCardPopover from '../components/conversations/ModelCardPopover';
import { getProviderColor, getProviderMeta, stripProviderPrefix } from '../components/conversations/providerMeta';
import ToolsPanel from '../components/agents/ToolsPanel';
import AgentRatingPanel from '../components/agents/AgentRatingPanel';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import type { ModelCard } from '../modelcard/types';
import { resolveModelCardsFromNames } from '../modelcard/resolve';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { formatDateShort } from '../utils/date';
import { TokenizedText } from '../components/tokenizer/TokenizedText';
import { useTokenizer } from '../components/tokenizer/useTokenizer';
import { getEncoding, AVAILABLE_ENCODINGS, type EncodingName } from '../components/tokenizer/encodingMap';
import { getTokenizeControlStyles } from '../components/tokenizer/tokenizeControls.styles';

const VERSION_PAGE_SIZE = 50;

export type AgentDetailPageProps = {
  dataSource?: AgentsDataSource;
  modelCardClient?: ModelCardClient;
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
  titleMeta: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  badgeRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
  }),
  anonymousBanner: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.warning.border}`,
    background: theme.colors.warning.transparent,
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
  }),
  statsGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: theme.spacing(1),
  }),
  statCell: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
  }),
  statLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.3,
  }),
  statValue: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
  }),
  panel: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    overflow: 'hidden',
  }),
  panelHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  panelBody: css({
    padding: theme.spacing(1.5),
  }),
  versionControls: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    [`@media (max-width: 640px)`]: {
      flexDirection: 'column' as const,
      alignItems: 'stretch',
    },
  }),
  versionSelect: css({
    flex: 1,
    minWidth: 0,
  }),
  systemPrompt: css({
    margin: 0,
    maxHeight: 400,
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    lineHeight: 1.6,
    color: theme.colors.text.primary,
  }),
  modelChipsRow: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1),
  }),
  modelChipAnchor: css({
    position: 'relative' as const,
    display: 'inline-flex',
  }),
  modelChip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: '12px',
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    '&:hover': {
      borderColor: theme.colors.text.secondary,
      background: theme.colors.action.hover,
    },
  }),
  modelChipActive: css({
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  modelChipDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  }),
  ...getTokenizeControlStyles(theme),
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

type StatCellProps = {
  label: string;
  value: string | number;
  tooltip: string;
};

function StatCell({ label, value, tooltip }: StatCellProps) {
  const styles = useStyles2(getStyles);
  return (
    <Tooltip content={tooltip} placement="top">
      <div className={styles.statCell}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
      </div>
    </Tooltip>
  );
}

export default function AgentDetailPage({
  dataSource = defaultAgentsDataSource,
  modelCardClient = defaultModelCardClient,
}: AgentDetailPageProps) {
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
  const [initialRatingLoading, setInitialRatingLoading] = useState(false);
  const [initialRating, setInitialRating] = useState<AgentRatingResponse | null>(null);
  const [initialRatingError, setInitialRatingError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [modelCards, setModelCards] = useState<Map<string, ModelCard>>(new Map());
  const [openModel, setOpenModel] = useState<{ key: string; anchorRect: DOMRect } | null>(null);
  const detailRequestVersion = useRef(0);
  const versionsRequestVersion = useRef(0);
  const ratingRequestVersion = useRef(0);

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
    ratingRequestVersion.current += 1;
    const version = ratingRequestVersion.current;

    queueMicrotask(() => {
      if (ratingRequestVersion.current !== version) {
        return;
      }
      setInitialRating(null);
      setInitialRatingLoading(true);
      setInitialRatingError('');
    });

    dataSource
      .lookupAgentRating(agentName, selectedVersion.length > 0 ? selectedVersion : undefined)
      .then((rating) => {
        if (ratingRequestVersion.current !== version) {
          return;
        }
        setInitialRating(rating);
      })
      .catch((err: unknown) => {
        if (ratingRequestVersion.current !== version) {
          return;
        }
        setInitialRating(null);
        setInitialRatingError(err instanceof Error ? err.message : 'Failed to load latest agent rating');
      })
      .finally(() => {
        if (ratingRequestVersion.current !== version) {
          return;
        }
        setInitialRatingLoading(false);
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

  useEffect(() => {
    if (!detail || detail.models.length === 0) {
      setModelCards(new Map());
      return;
    }
    resolveModelCardsFromNames(
      detail.models.map((m) => ({ name: m.name, provider: m.provider })),
      modelCardClient
    )
      .then((cards) => setModelCards(cards))
      .catch(() => setModelCards(new Map()));
  }, [detail, modelCardClient]);

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

  const versionSelectOptions = useMemo(() => {
    return versionOptions.map((v) => ({
      label: `${v.effective_version.replace(/^sha256:/, '').slice(0, 12)}…  ·  ${formatDateShort(v.last_seen_at)}  ·  ${v.generation_count.toLocaleString()} gen`,
      value: v.effective_version,
      description: v.declared_version_latest ? `Declared: ${v.declared_version_latest}` : undefined,
    }));
  }, [versionOptions]);

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

  const autoEncoding = useMemo(() => {
    if (!detail) {
      return 'cl100k_base' as EncodingName;
    }
    const firstModel = detail.models[0];
    return getEncoding(firstModel?.provider, firstModel?.name);
  }, [detail]);

  const versionKey = `${agentName}:${selectedVersion}`;
  const [tokenizeState, setTokenizeState] = useState<{
    versionKey: string;
    sections: Record<string, boolean>;
    encodingOverride: EncodingName | null;
  }>({ versionKey, sections: {}, encodingOverride: null });

  const tokenizedSections = tokenizeState.versionKey === versionKey ? tokenizeState.sections : {};
  const encodingOverride = tokenizeState.versionKey === versionKey ? tokenizeState.encodingOverride : null;

  const activeEncoding = encodingOverride ?? autoEncoding;
  const anyTokenized = Object.values(tokenizedSections).some(Boolean);
  const { encode, decode, isLoading: tokenizerLoading } = useTokenizer(anyTokenized ? activeEncoding : null);

  const setEncodingOverride = useCallback(
    (enc: EncodingName | null) => {
      setTokenizeState((prev) => ({
        versionKey,
        sections: prev.versionKey === versionKey ? prev.sections : {},
        encodingOverride: enc,
      }));
    },
    [versionKey]
  );

  const toggleSection = useCallback(
    (key: string) => {
      setTokenizeState((prev) => {
        const sections = prev.versionKey === versionKey ? prev.sections : {};
        return {
          versionKey,
          sections: { ...sections, [key]: !sections[key] },
          encodingOverride: prev.versionKey === versionKey ? prev.encodingOverride : null,
        };
      });
    },
    [versionKey]
  );

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
        <Button variant="secondary" icon="arrow-left" onClick={() => navigate(`${PLUGIN_BASE}/${ROUTES.Agents}`)}>
          Back to agents
        </Button>
      </div>
    );
  }

  const activeVersion = selectedVersion.length > 0 ? selectedVersion : detail.effective_version;

  return (
    <div className={styles.page}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.titleRow}>
        <div className={styles.titleMeta}>
          <Button
            variant="secondary"
            fill="text"
            size="sm"
            icon="arrow-left"
            onClick={() => navigate(`${PLUGIN_BASE}/${ROUTES.Agents}`)}
          >
            All agents
          </Button>
          <Text element="h2">{isAnonymous ? 'Unnamed agent bucket' : detail.agent_name}</Text>
          <div className={styles.badgeRow}>
            <Badge text={isAnonymous ? 'Anonymous' : 'Named'} color={isAnonymous ? 'orange' : 'green'} />
            <Badge text={`${detail.generation_count.toLocaleString()} generations`} color="blue" />
            <Badge text={`${detail.tool_count} tools`} color="purple" />
          </div>
          {detail.models.length > 0 && (
            <div className={styles.modelChipsRow}>
              {detail.models.map((model) => {
                const cardKey = `${model.provider}::${model.name}`;
                const card = modelCards.get(cardKey) ?? null;
                const meta = getProviderMeta(model.provider);
                const chipLabel = card
                  ? stripProviderPrefix(card.name || card.source_model_id, meta.label)
                  : stripProviderPrefix(model.name, meta.label);
                const dotColor = getProviderColor(model.provider);
                const isOpen = openModel?.key === cardKey;
                return (
                  <div key={cardKey} className={styles.modelChipAnchor}>
                    <button
                      type="button"
                      className={`${styles.modelChip} ${isOpen ? styles.modelChipActive : ''}`}
                      onClick={(event) => {
                        if (isOpen) {
                          setOpenModel(null);
                          return;
                        }
                        setOpenModel({ key: cardKey, anchorRect: event.currentTarget.getBoundingClientRect() });
                      }}
                      aria-label={`model card ${chipLabel}`}
                    >
                      <span className={styles.modelChipDot} style={{ background: dotColor }} />
                      <span>{chipLabel}</span>
                    </button>
                    {isOpen && card && (
                      <ModelCardPopover
                        card={card}
                        anchorRect={openModel?.anchorRect ?? null}
                        onClose={() => setOpenModel(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {isAnonymous && (
        <div className={styles.anonymousBanner}>
          <Text variant="bodySmall" color="secondary">
            This bucket aggregates generations where <code>gen_ai.agent.name</code> was missing. Treat versions here as
            diagnostic clusters.
          </Text>
        </div>
      )}

      <div className={styles.statsGrid}>
        <StatCell
          label="Last seen"
          value={formatDate(detail.last_seen_at)}
          tooltip="The most recent time any generation was recorded for this agent version."
        />
        <StatCell
          label="First seen"
          value={formatDate(detail.first_seen_at)}
          tooltip="The earliest time a generation was recorded for this agent version."
        />
        <StatCell
          label="Prompt tokens"
          value={detail.token_estimate.system_prompt}
          tooltip="Estimated tokens consumed by the system prompt in this version."
        />
        <StatCell
          label="Tools tokens"
          value={detail.token_estimate.tools_total}
          tooltip="Estimated tokens consumed by all tool schemas combined in this version."
        />
        <StatCell
          label="Total tokens"
          value={detail.token_estimate.total}
          tooltip="Sum of system prompt and tool tokens — the baseline context cost per generation."
        />
      </div>

      <AgentRatingPanel
        agentName={agentName}
        version={activeVersion}
        dataSource={dataSource}
        initialResult={initialRating}
        initialLoading={initialRatingLoading || initialRating?.status === 'pending'}
        initialError={initialRatingError}
      />

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <Text weight="medium">Version</Text>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.versionControls}>
            <div className={styles.versionSelect}>
              <Select
                options={versionSelectOptions}
                value={activeVersion}
                onChange={(selected) => selectVersion(selected?.value ?? '')}
                isLoading={loadingVersions}
                placeholder="Select a version…"
                aria-label="agent version selector"
              />
            </div>
            <Button variant="secondary" onClick={() => selectVersion('')} disabled={selectedVersion.length === 0}>
              Latest
            </Button>
            <Button
              variant="secondary"
              onClick={() => void loadMoreVersions()}
              disabled={loadingVersions || versionsCursor.length === 0}
            >
              {loadingVersions ? <Spinner size={14} /> : 'Load more'}
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <Text weight="medium">System prompt</Text>
          <span style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
            <span
              className={cx(styles.tokenizeBtn, tokenizedSections['system'] && styles.tokenizeBtnActive)}
              onClick={() => toggleSection('system')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  toggleSection('system');
                }
              }}
              role="button"
              tabIndex={0}
            >
              <Icon name="brackets-curly" size="xs" />
              {tokenizerLoading ? 'Loading\u2026' : 'Tokenize'}
            </span>
            {tokenizedSections['system'] && (
              <select
                className={styles.encodingSelect}
                aria-label="Tokenizer encoding"
                value={encodingOverride ?? ''}
                onChange={(e) => setEncodingOverride(e.target.value ? (e.target.value as EncodingName) : null)}
              >
                <option value="">Auto ({autoEncoding.replace('_base', '')})</option>
                {AVAILABLE_ENCODINGS.map((enc) => (
                  <option key={enc.value} value={enc.value}>
                    {enc.value.replace('_base', '')}
                  </option>
                ))}
              </select>
            )}
          </span>
        </div>
        <div className={styles.panelBody}>
          {detail.system_prompt.length > 0 ? (
            tokenizedSections['system'] && encode && decode ? (
              <div className={styles.systemPrompt}>
                <TokenizedText text={detail.system_prompt} encode={encode} decode={decode} />
              </div>
            ) : (
              <pre className={styles.systemPrompt}>{detail.system_prompt}</pre>
            )
          ) : (
            <pre className={styles.systemPrompt}>No system prompt recorded.</pre>
          )}
        </div>
      </div>

      <ToolsPanel
        tools={detail.tools}
        tokenized={tokenizedSections['tools']}
        onToggleTokenize={() => toggleSection('tools')}
        tokenizerLoading={tokenizerLoading}
        autoEncoding={autoEncoding}
        encodingOverride={encodingOverride}
        onEncodingChange={setEncodingOverride}
        encode={encode}
        decode={decode}
      />
    </div>
  );
}
