import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import { dateTime, type GrafanaTheme2 } from '@grafana/data';
import DataTable, { type ColumnDef } from '../components/shared/DataTable';
import AgentChipList from '../components/shared/AgentChipList';
import {
  Alert,
  Icon,
  Input,
  Spinner,
  Stack,
  Tab,
  TabsBar,
  Text,
  TimeRangePicker,
  Tooltip,
  useStyles2,
  useTheme2,
} from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentListItem } from '../agents/types';
import { buildAgentDetailByNameRoute, buildAnonymousAgentDetailRoute, PLUGIN_BASE } from '../constants';
import { AgentActivityTimeline } from '../components/agents/AgentActivityTimeline';
import { defaultDashboardDataSource, type DashboardDataSource } from '../dashboard/api';
import { computeRangeDuration, tokensByModelAndTypeQuery } from '../dashboard/queries';
import { emptyFilters, type PrometheusQueryResponse } from '../dashboard/types';
import {
  extractResolvePairs,
  BreakdownStatPanel,
  getBreakdownStatPanelStyles,
  getBarPalette,
  stringHash,
  formatStatValue,
  formatRelativeTime,
} from '../components/dashboard/dashboardShared';
import { useResolvedModelPricing } from '../components/dashboard/useResolvedModelPricing';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { lookupPricing } from '../dashboard/cost';
import { buildAgentDetailHref } from '../components/dashboard/ViewAgentsLink';
import { PageInsightBar } from '../components/insight/PageInsightBar';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
import { DashboardSummaryBar } from '../components/dashboard/DashboardSummaryBar';
import { TopStat } from '../components/TopStat';

const PAGE_SIZE = 24;
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HIGH_CHURN_THRESHOLD = 5;
const HERO_TOP_LIMIT = 10;
const CHART_HEIGHT = 600;
const ESTIMATED_USD_PER_TOKEN = 2.5 / 1_000_000;
const STARRED_AGENTS_STORAGE_KEY = 'sigil.agents.starred';

export type AgentsPageProps = {
  dataSource?: AgentsDataSource;
  dashboardDataSource?: DashboardDataSource;
};

type AgentsPageTab = 'info' | 'table';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    minHeight: 0,
    marginTop: theme.spacing(-4),
  }),
  tabsRow: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),

  // --- Overview grid layout ---
  gridWrapper: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  grid: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(3),
    flex: 1,
    minWidth: 0,
  }),
  panelRowEqual: css({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(1),
  }),

  // --- Risk signal strip ---
  riskStrip: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(0.75, 2),
    flexWrap: 'wrap' as const,
  }),
  riskSignal: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    padding: theme.spacing(0.25, 1),
    borderRadius: 999,
    border: `1px solid ${theme.colors.border.weak}`,
    background: 'transparent',
    whiteSpace: 'nowrap' as const,
  }),
  riskSignalWarning: css({
    color: theme.colors.warning.text,
    border: `1px solid ${theme.colors.warning.border}`,
    background: theme.colors.warning.transparent,
  }),
  riskSignalValue: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),

  // --- Footprint panel dual-value ---
  footprintSecondary: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightRegular,
    marginLeft: theme.spacing(0.5),
  }),
  footprintCostSuffix: css({
    color: theme.colors.text.disabled,
    marginLeft: theme.spacing(0.25),
  }),

  // --- Table cell styles (used in DataTable column renderers) ---
  cellRight: css({
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  }),

  // --- Agents tab ---
  searchRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  searchInput: css({
    flex: 1,
    maxWidth: 400,
  }),
  agentsTableWrap: css({
    overflowX: 'auto',
  }),
  promptCell: css({
    maxWidth: 360,
    whiteSpace: 'normal' as const,
    color: theme.colors.text.secondary,
    overflowWrap: 'anywhere' as const,
  }),

  // --- Star button ---
  starCell: css({
    width: 32,
    textAlign: 'center' as const,
    padding: theme.spacing(0.5),
  }),
  starButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(0.25),
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: theme.colors.text.disabled,
    borderRadius: theme.shape.radius.default,
    transition: 'color 0.15s ease',
    '&:hover': {
      color: theme.colors.warning.text,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: 1,
    },
  }),
  starButtonActive: css({
    color: theme.colors.warning.text,
  }),

  // --- Shared ---
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

// ---------------------------------------------------------------------------
// Starred agents (localStorage)
// ---------------------------------------------------------------------------

function readStarredAgents(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STARRED_AGENTS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    }
  } catch {
    // Ignore corrupt or unavailable storage.
  }
  return new Set();
}

function writeStarredAgents(starred: Set<string>): void {
  try {
    window.localStorage.setItem(STARRED_AGENTS_STORAGE_KEY, JSON.stringify([...starred]));
  } catch {
    // Ignore storage write errors.
  }
}

function useStarredAgents(): [Set<string>, (agentName: string) => void] {
  const [starred, setStarred] = useState<Set<string>>(() => readStarredAgents());

  const toggle = useCallback((agentName: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(agentName)) {
        next.delete(agentName);
      } else {
        next.add(agentName);
      }
      writeStarredAgents(next);
      return next;
    });
  }, []);

  return [starred, toggle];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cardLabel(item: AgentListItem): string {
  if (item.agent_name.trim().length > 0) {
    return item.agent_name;
  }
  return 'anonymous';
}

function agentDisplayName(item: AgentListItem): string {
  return item.agent_name.trim().length > 0 ? item.agent_name : 'Unnamed agent bucket';
}

function agentHref(displayName: string): string {
  return buildAgentDetailHref(displayName === 'Unnamed agent bucket' ? '' : displayName);
}

function aggregateAgentUsageByName(
  response: PrometheusQueryResponse | null | undefined,
  pricingMap: ReturnType<typeof useResolvedModelPricing>['pricingMap']
) {
  const usageByName = new Map<string, { tokens: number; costUSD: number }>();
  if (!response || response.data.resultType !== 'vector') {
    return usageByName;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
  for (const result of results) {
    const metric = result.metric;
    const agentName = metric.gen_ai_agent_name ?? '';
    const tokenType = metric.gen_ai_token_type ?? '';
    const tokenCount = parseFloat(result.value[1]);
    if (!Number.isFinite(tokenCount)) {
      continue;
    }
    const current = usageByName.get(agentName) ?? { tokens: 0, costUSD: 0 };
    current.tokens += tokenCount;
    const pricing = lookupPricing(pricingMap, metric.gen_ai_request_model ?? '', metric.gen_ai_provider_name);
    if (pricing) {
      switch (tokenType) {
        case 'input':
          current.costUSD += tokenCount * (pricing.prompt_usd_per_token ?? 0);
          break;
        case 'output':
          current.costUSD += tokenCount * (pricing.completion_usd_per_token ?? 0);
          break;
        case 'cache_read':
          current.costUSD += tokenCount * (pricing.input_cache_read_usd_per_token ?? 0);
          break;
        case 'cache_write':
        case 'cache_creation':
          current.costUSD += tokenCount * (pricing.input_cache_write_usd_per_token ?? 0);
          break;
      }
    }
    usageByName.set(agentName, current);
  }
  return usageByName;
}

function buildSyntheticVector(
  entries: Array<{ name: string; value: number }>,
  labelKey: string
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: entries.map((e) => ({
        metric: { [labelKey]: e.name },
        value: [0, String(e.value)] as [number, string],
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// RiskSignalStrip
// ---------------------------------------------------------------------------

type RiskSignal = { icon: 'eye-slash' | 'clock-nine' | 'sync'; value: number; label: string };

function RiskSignalStrip({
  anonymousCount,
  staleCount,
  highChurnCount,
}: {
  anonymousCount: number;
  staleCount: number;
  highChurnCount: number;
}) {
  const styles = useStyles2(getStyles);

  const signals: RiskSignal[] = [
    { icon: 'eye-slash', value: anonymousCount, label: 'anonymous buckets' },
    { icon: 'clock-nine', value: staleCount, label: 'stale (> 7 days)' },
    { icon: 'sync', value: highChurnCount, label: `high churn (${HIGH_CHURN_THRESHOLD}+ versions)` },
  ];

  return (
    <div className={styles.riskStrip} role="status" aria-label="risk signals">
      {signals.map((signal) => (
        <span key={signal.icon} className={cx(styles.riskSignal, signal.value > 0 && styles.riskSignalWarning)}>
          <Icon name={signal.icon} size="sm" />
          <span className={styles.riskSignalValue}>{signal.value}</span>
          {signal.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentFootprintPanel
// ---------------------------------------------------------------------------

type FootprintItem = {
  name: string;
  tokens: number;
  costUSD: number;
};

function AgentFootprintPanel({
  title,
  items,
  totalTokens,
  totalCostUSD,
  loading,
  height,
  getItemHref,
}: {
  title: string;
  items: FootprintItem[];
  totalTokens: number;
  totalCostUSD: number;
  loading: boolean;
  height: number;
  getItemHref?: (name: string) => string;
}) {
  const bsp = useStyles2(getBreakdownStatPanelStyles);
  const pageStyles = useStyles2(getStyles);
  const theme = useTheme2();
  const palette = useMemo(() => getBarPalette(theme), [theme]);

  const fmtTokens = (v: number) => formatStatValue(v, 'short');
  const fmtCost = (v: number) => formatStatValue(v, 'currencyUSD');

  if (loading) {
    return (
      <div className={bsp.bspPanel} style={{ height }}>
        <div className={bsp.bspHeader}>
          <span className={bsp.bspTitle}>{title}</span>
        </div>
        <div className={bsp.bspCenter}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={bsp.bspPanel} style={{ height }}>
        <div className={bsp.bspHeader}>
          <span className={bsp.bspTitle}>{title}</span>
        </div>
        <div className={bsp.bspCenter}>
          <span className={bsp.bspBigValue}>{fmtTokens(0)}</span>
        </div>
      </div>
    );
  }

  const maxTokens = items.reduce((max, i) => Math.max(max, i.tokens), 0);

  return (
    <div className={bsp.bspPanel} style={{ height }}>
      <div className={bsp.bspHeader}>
        <span className={bsp.bspTitle}>{title}</span>
        <div className={bsp.bspValueRow}>
          <span className={bsp.bspBigValue}>{fmtTokens(totalTokens)}</span>
          <span className={pageStyles.footprintSecondary}>{fmtCost(totalCostUSD)}</span>
        </div>
      </div>
      <div className={bsp.bspList}>
        {items.map((item) => {
          const barWidth = maxTokens > 0 ? (item.tokens / maxTokens) * 100 : 0;
          const color = palette[stringHash(item.name) % palette.length];
          return (
            <div key={item.name} className={bsp.bspBarRow}>
              <div className={bsp.bspBarMeta}>
                <span className={bsp.bspBarDot} style={{ background: color }} />
                {getItemHref ? (
                  <a href={getItemHref(item.name)} className={`${bsp.bspBarName} ${bsp.bspBarNameClickable}`}>
                    {item.name}
                  </a>
                ) : (
                  <span className={bsp.bspBarName}>{item.name}</span>
                )}
                <span className={bsp.bspBarValue}>
                  {fmtTokens(item.tokens)}
                  <span className={pageStyles.footprintCostSuffix}>&nbsp;·&nbsp;{fmtCost(item.costUSD)}</span>
                </span>
              </div>
              <div className={bsp.bspBarTrack}>
                <div className={bsp.bspBarFill} style={{ width: `${barWidth}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgentsPage({
  dataSource = defaultAgentsDataSource,
  dashboardDataSource = defaultDashboardDataSource,
}: AgentsPageProps) {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const [starredAgents, toggleStar] = useStarredAgents();

  const { timeRange, setTimeRange, searchParams, setSearchParams: setUrlParams } = useFilterUrlState();

  const [items, setItems] = useState<AgentListItem[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const searchInput = searchParams.get('search') ?? '';
  const [namePrefix, setNamePrefix] = useState('');
  const activeTab: AgentsPageTab = searchParams.get('tab') === 'table' ? 'table' : 'info';
  const requestVersion = useRef(0);
  const inFlightLoadMore = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const rangeFromSec = Math.floor(timeRange.from.valueOf() / 1000);
  const rangeToSec = Math.floor(timeRange.to.valueOf() / 1000);
  const telemetryRangeDuration = useMemo(
    () => computeRangeDuration(rangeFromSec, rangeToSec),
    [rangeFromSec, rangeToSec]
  );
  const usageByModelAndType = usePrometheusQuery(
    dashboardDataSource,
    tokensByModelAndTypeQuery(emptyFilters, telemetryRangeDuration, 'agent'),
    rangeFromSec,
    rangeToSec,
    'instant'
  );
  const resolvePairs = useMemo(() => extractResolvePairs(usageByModelAndType.data), [usageByModelAndType.data]);
  const resolvedPricing = useResolvedModelPricing(dashboardDataSource, resolvePairs);

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
      .listAgents(PAGE_SIZE, '', namePrefix, rangeFromSec, rangeToSec)
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
  }, [dataSource, namePrefix, rangeFromSec, rangeToSec]);

  // --- Summary computation ---

  const summary = useMemo(() => {
    const rangeFrom = timeRange.from.valueOf();
    const rangeTo = timeRange.to.valueOf();
    const usageByName = aggregateAgentUsageByName(usageByModelAndType.data, resolvedPricing.pricingMap);
    let anonymousCount = 0;
    let seenInRangeCount = 0;
    let staleCount = 0;
    let highChurnCount = 0;
    let totalGenerationsWithRuntime = 0;
    let totalRuntimeTokens = 0;
    let totalRuntimeCostUSD = 0;
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
      const usage = usageByName.get(item.agent_name) ?? usageByName.get(item.agent_name.trim()) ?? null;
      if (usage) {
        totalGenerationsWithRuntime += item.generation_count;
        totalRuntimeTokens += usage.tokens;
        totalRuntimeCostUSD += usage.costUSD;
      }
    }
    const topByGenerations = [...items]
      .filter((item) => item.generation_count > 0)
      .sort((a, b) => b.generation_count - a.generation_count || cardLabel(a).localeCompare(cardLabel(b)))
      .slice(0, HERO_TOP_LIMIT);
    const topByTokenFootprint = [...items]
      .filter((item) => {
        const usage = usageByName.get(item.agent_name) ?? usageByName.get(item.agent_name.trim()) ?? null;
        if (usage) {
          return usage.tokens > 0;
        }
        return item.token_estimate.total > 0;
      })
      .sort((a, b) => {
        const aUsage = usageByName.get(a.agent_name) ?? usageByName.get(a.agent_name.trim()) ?? null;
        const bUsage = usageByName.get(b.agent_name) ?? usageByName.get(b.agent_name.trim()) ?? null;
        const aTokens = aUsage ? aUsage.tokens : a.token_estimate.total;
        const bTokens = bUsage ? bUsage.tokens : b.token_estimate.total;
        return bTokens - aTokens || cardLabel(a).localeCompare(cardLabel(b));
      })
      .slice(0, HERO_TOP_LIMIT);
    const totalTokens = totalRuntimeTokens;
    const totalCostUSD = totalRuntimeCostUSD;
    return {
      loadedAgents: items.length,
      namedAgents: items.length - anonymousCount,
      anonymousCount,
      seenInRangeCount,
      staleCount,
      highChurnCount,
      totalGenerations: totalGenerationsWithRuntime,
      totalTokens,
      totalCostUSD,
      averageTokensPerGeneration:
        totalGenerationsWithRuntime > 0 ? Math.round(totalTokens / totalGenerationsWithRuntime) : 0,
      averageCostPerGenerationUSD: totalGenerationsWithRuntime > 0 ? totalCostUSD / totalGenerationsWithRuntime : 0,
      topByGenerations,
      topByTokenFootprint,
      usageByName,
    };
  }, [items, resolvedPricing.pricingMap, timeRange, usageByModelAndType.data]);

  // --- Derived data for overview panels ---

  const topByGensSyntheticData = useMemo<PrometheusQueryResponse>(
    () =>
      buildSyntheticVector(
        summary.topByGenerations.map((item) => ({
          name: agentDisplayName(item),
          value: item.generation_count,
        })),
        'agent_name'
      ),
    [summary.topByGenerations]
  );

  const footprintItems = useMemo<FootprintItem[]>(
    () =>
      summary.topByTokenFootprint.map((item) => {
        const usage = summary.usageByName.get(item.agent_name) ?? summary.usageByName.get(item.agent_name.trim());
        const tokens = usage ? usage.tokens : item.token_estimate.total;
        const costUSD = usage ? usage.costUSD : item.token_estimate.total * ESTIMATED_USD_PER_TOKEN;
        return { name: agentDisplayName(item), tokens, costUSD };
      }),
    [summary.topByTokenFootprint, summary.usageByName]
  );

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const aStarred = starredAgents.has(a.agent_name) ? 1 : 0;
        const bStarred = starredAgents.has(b.agent_name) ? 1 : 0;
        return bStarred - aStarred;
      }),
    [items, starredAgents]
  );

  const agentColumns = useMemo<Array<ColumnDef<AgentListItem>>>(
    () => [
      {
        id: 'star',
        header: '',
        width: 32,
        cell: (item) => {
          const name = agentDisplayName(item);
          const isStarred = starredAgents.has(item.agent_name);
          return (
            <div className={styles.starCell}>
              <button
                className={cx(styles.starButton, isStarred && styles.starButtonActive)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStar(item.agent_name);
                }}
                aria-label={isStarred ? `unstar agent ${name}` : `star agent ${name}`}
              >
                <Icon name={isStarred ? 'favorite' : 'star'} size="md" />
              </button>
            </div>
          );
        },
      },
      {
        id: 'agent',
        header: 'Agent',
        width: 280,
        cell: (item) => <AgentChipList agents={[agentDisplayName(item)]} maxVisible={1} />,
      },
      {
        id: 'latest_seen',
        header: 'Latest seen',
        width: 100,
        cell: (item) => (
          <Tooltip content={new Date(item.latest_seen_at).toLocaleString()} placement="left">
            <span>{formatRelativeTime(item.latest_seen_at)}</span>
          </Tooltip>
        ),
      },
      {
        id: 'versions',
        header: 'Versions',
        width: 80,
        align: 'right',
        cell: (item) => <span className={styles.cellRight}>{item.version_count}</span>,
      },
      {
        id: 'tools',
        header: 'Tools',
        width: 60,
        align: 'right',
        cell: (item) => <span className={styles.cellRight}>{item.tool_count}</span>,
      },
      {
        id: 'generations',
        header: 'Generations',
        width: 100,
        align: 'right',
        cell: (item) => <span className={styles.cellRight}>{formatStatValue(item.generation_count, 'short')}</span>,
      },
      {
        id: 'prompt_prefix',
        header: 'Prompt prefix',
        cell: (item) => (
          <span className={styles.promptCell}>
            {item.system_prompt_prefix.length > 0 ? item.system_prompt_prefix : '-'}
          </span>
        ),
      },
    ],
    [
      starredAgents,
      toggleStar,
      styles.starCell,
      styles.starButton,
      styles.starButtonActive,
      styles.cellRight,
      styles.promptCell,
    ]
  );

  // --- AI insight context ---

  const agentInsightDataContext = useMemo(() => {
    if (loading || items.length === 0) {
      return null;
    }
    const topGens = summary.topByGenerations
      .slice(0, 5)
      .map((a) => `  ${a.agent_name || 'anonymous'}: ${a.generation_count} generations`)
      .join('\n');
    const topFootprint = summary.topByTokenFootprint
      .slice(0, 5)
      .map((a) => {
        const usage = summary.usageByName.get(a.agent_name) ?? summary.usageByName.get(a.agent_name.trim());
        const tokens = usage ? usage.tokens : a.token_estimate.total;
        return `  ${a.agent_name || 'anonymous'}: ${Math.round(tokens).toLocaleString()} tokens`;
      })
      .join('\n');
    return [
      `Agents in time range: ${summary.seenInRangeCount}`,
      `Total loaded agents: ${summary.loadedAgents}`,
      `Total generations (runtime): ${summary.totalGenerations}`,
      `Total runtime tokens: ${Math.round(summary.totalTokens).toLocaleString()}`,
      `Total runtime cost: $${summary.totalCostUSD.toFixed(4)}`,
      `Avg tokens per generation: ${summary.averageTokensPerGeneration}`,
      `Anonymous agent buckets: ${summary.anonymousCount}`,
      `Stale agents (> 7 days): ${summary.staleCount}`,
      `High churn agents (${HIGH_CHURN_THRESHOLD}+ versions): ${summary.highChurnCount}`,
      `Top agents by generations:\n${topGens}`,
      `Top agents by token footprint:\n${topFootprint}`,
    ].join('\n');
  }, [loading, items.length, summary]);

  // --- Event handlers ---

  const handleOpenAgent = (item: AgentListItem) => {
    const route =
      item.agent_name.trim().length > 0
        ? buildAgentDetailByNameRoute(item.agent_name)
        : buildAnonymousAgentDetailRoute();
    void navigate(`${PLUGIN_BASE}/${route}`);
  };

  const setSearchInput = useCallback(
    (value: string) => {
      setUrlParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '') {
            next.delete('search');
          } else {
            next.set('search', value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setUrlParams]
  );

  const handleTabChange = useCallback(
    (tab: AgentsPageTab) => () => {
      setUrlParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'info') {
            next.delete('tab');
          } else {
            next.set('tab', tab);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setUrlParams]
  );

  const loadMore = useCallback(async () => {
    if (inFlightLoadMore.current || loadingMore || nextCursor.length === 0) {
      return;
    }
    inFlightLoadMore.current = true;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const response = await dataSource.listAgents(PAGE_SIZE, nextCursor, namePrefix, rangeFromSec, rangeToSec);
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
  }, [dataSource, loadingMore, namePrefix, nextCursor, rangeFromSec, rangeToSec]);

  useEffect(() => {
    if (
      activeTab !== 'table' ||
      loading ||
      loadingMore ||
      nextCursor.length === 0 ||
      typeof IntersectionObserver === 'undefined'
    ) {
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
        rootMargin: '200px 0px',
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, loadMore, loading, loadingMore, nextCursor]);

  // --- Render ---

  return (
    <div className={styles.page}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      {loading ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : (
        <>
          <div className={styles.tabsRow}>
            <TabsBar>
              <Tab label="Overview" active={activeTab === 'info'} onChangeTab={handleTabChange('info')} />
              <Tab label="Agents" active={activeTab === 'table'} onChangeTab={handleTabChange('table')} />
            </TabsBar>
            <TimeRangePicker
              value={timeRange}
              onChange={setTimeRange}
              onChangeTimeZone={() => {}}
              onMoveBackward={() => {
                const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
                const from = dateTime(timeRange.from.valueOf() - diff);
                const to = dateTime(timeRange.to.valueOf() - diff);
                setTimeRange({ from, to, raw: { from: from.toISOString(), to: to.toISOString() } });
              }}
              onMoveForward={() => {
                const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
                const from = dateTime(timeRange.from.valueOf() + diff);
                const to = dateTime(timeRange.to.valueOf() + diff);
                setTimeRange({ from, to, raw: { from: from.toISOString(), to: to.toISOString() } });
              }}
              onZoom={() => {
                const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
                const from = dateTime(timeRange.from.valueOf() - diff / 2);
                const to = dateTime(timeRange.to.valueOf() + diff / 2);
                setTimeRange({ from, to, raw: { from: from.toISOString(), to: to.toISOString() } });
              }}
              isOnCanvas
            />
          </div>

          {activeTab === 'info' ? (
            items.length === 0 ? (
              <div className={styles.empty}>
                <Icon name="search" size="xl" />
                <Text color="secondary">No agents matched this search in the current tenant.</Text>
              </div>
            ) : (
              <div className={styles.gridWrapper}>
                <DashboardSummaryBar>
                  <TopStat
                    label="Agents"
                    value={summary.seenInRangeCount}
                    loading={false}
                    helpTooltip="Agents with latest_seen_at inside the selected time range."
                  />
                  <TopStat
                    label="Total Generations"
                    value={summary.totalGenerations}
                    loading={false}
                    helpTooltip="Sum of generation_count for agents with runtime token usage."
                  />
                  <TopStat
                    label="Total Tokens"
                    value={summary.totalTokens}
                    unit="short"
                    loading={usageByModelAndType.loading}
                    helpTooltip="Runtime token usage across loaded agents in the selected time range."
                  />
                  <TopStat
                    label="Estimated Cost"
                    value={summary.totalCostUSD}
                    unit="currencyUSD"
                    loading={usageByModelAndType.loading || resolvedPricing.loading}
                    helpTooltip="Estimated cost based on resolved model pricing and runtime token usage."
                  />
                </DashboardSummaryBar>

                <RiskSignalStrip
                  anonymousCount={summary.anonymousCount}
                  staleCount={summary.staleCount}
                  highChurnCount={summary.highChurnCount}
                />

                <PageInsightBar
                  prompt="Analyze this agent fleet overview. Flag concentration risks, anomalies in usage patterns, or agents that need attention."
                  origin="sigil-plugin/agents-insight"
                  dataContext={agentInsightDataContext}
                />

                <div className={styles.grid}>
                  <AgentActivityTimeline
                    dashboardDataSource={dashboardDataSource}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                  />

                  <div className={styles.panelRowEqual}>
                    <BreakdownStatPanel
                      title="Top by Generations"
                      data={topByGensSyntheticData}
                      loading={false}
                      breakdownLabel="agent_name"
                      height={CHART_HEIGHT}
                      getItemHref={agentHref}
                    />
                    <AgentFootprintPanel
                      title="Agent Footprint"
                      items={footprintItems}
                      totalTokens={summary.totalTokens}
                      totalCostUSD={summary.totalCostUSD}
                      loading={usageByModelAndType.loading || resolvedPricing.loading}
                      height={CHART_HEIGHT}
                      getItemHref={agentHref}
                    />
                  </div>
                </div>
              </div>
            )
          ) : (
            <>
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

              {items.length === 0 ? (
                <div className={styles.empty}>
                  <Icon name="search" size="xl" />
                  <Text color="secondary">No agents matched this search in the current tenant.</Text>
                </div>
              ) : (
                <>
                  <div className={styles.agentsTableWrap}>
                    <DataTable<AgentListItem>
                      columns={agentColumns}
                      data={sortedItems}
                      keyOf={(item) => `${item.agent_name}:${item.latest_effective_version}`}
                      onRowClick={(item, e) => {
                        const name = agentDisplayName(item);
                        const href = agentHref(name);
                        if (e.metaKey || e.ctrlKey) {
                          window.open(href, '_blank');
                        } else {
                          handleOpenAgent(item);
                        }
                      }}
                      rowRole="link"
                      rowAriaLabel={(item) => `open agent ${cardLabel(item)}`}
                      rowVariant={(item) => (item.agent_name.trim().length === 0 ? 'warning' : undefined)}
                      panel={true}
                      scrollable={true}
                      minWidth={880}
                      ariaLabel="agents index table"
                    />
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
            </>
          )}
        </>
      )}
    </div>
  );
}
