import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import { dateTime, dateTimeParse, type GrafanaTheme2, type TimeRange } from '@grafana/data';
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
} from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentListItem } from '../agents/types';
import { buildAgentDetailByNameRoute, buildAnonymousAgentDetailRoute, PLUGIN_BASE } from '../constants';
import { formatDateShort } from '../utils/date';
import { AgentActivityTimeline } from '../components/agents/AgentActivityTimeline';
import { defaultDashboardDataSource, type DashboardDataSource } from '../dashboard/api';
import { computeRangeDuration, tokensByModelAndTypeQuery } from '../dashboard/queries';
import { emptyFilters, type PrometheusQueryResponse } from '../dashboard/types';
import { extractResolvePairs } from '../components/dashboard/dashboardShared';
import { useResolvedModelPricing } from '../components/dashboard/useResolvedModelPricing';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { lookupPricing } from '../dashboard/cost';
import {
  default as TokenCostBox,
  TOKEN_COST_MODE_CHANGE_EVENT,
  TOKEN_COST_MODE_STORAGE_KEY,
  type TokenCostMode,
} from '../components/agents/TokenCostBox';
import { PageInsightBar } from '../components/insight/PageInsightBar';

const PAGE_SIZE = 24;
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HIGH_CHURN_THRESHOLD = 5;
const HERO_TOP_LIMIT = 10;
const ESTIMATED_USD_PER_TOKEN = 2.5 / 1_000_000;
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export type AgentsPageProps = {
  dataSource?: AgentsDataSource;
  dashboardDataSource?: DashboardDataSource;
};

type AgentsPageTab = 'info' | 'table';

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
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    width: '100%',
  }),
  hero: css({
    width: '100%',
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
  labelWithHelp: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  helpIcon: css({
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
  heroSectionHeading: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  footprintModeSelect: css({
    boxSizing: 'border-box',
    minHeight: 28,
    height: 28,
    background: theme.colors.background.primary,
    color: theme.colors.text.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: `0 ${theme.spacing(0.5)}`,
    fontSize: theme.typography.body.fontSize,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '24px',
    cursor: 'pointer',
    width: 96,
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
    color: theme.colors.text.primary,
    fontSize: theme.typography.body.fontSize,
    whiteSpace: 'nowrap' as const,
  }),
  rankValueNumber: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  rankValueMuted: css({
    color: theme.colors.text.secondary,
  }),
  rankValueAffix: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
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

function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

function formatUSD(value: number): string {
  const absValue = Math.abs(value);
  const decimals = absValue < 0.01 ? 6 : absValue < 1 ? 4 : 2;
  return `$${value.toFixed(decimals)}`;
}

function splitMutedZeroPrefix(value: string): { leading: string; rest: string } {
  const isNegative = value.startsWith('-');
  const unsigned = isNegative ? value.slice(1) : value;
  if (!unsigned.startsWith('0.')) {
    return { leading: '', rest: value };
  }

  let firstSignificantIndex = 2;
  while (firstSignificantIndex < unsigned.length && unsigned[firstSignificantIndex] === '0') {
    firstSignificantIndex += 1;
  }
  if (firstSignificantIndex === 2) {
    return { leading: '', rest: value };
  }

  const leading = `${isNegative ? '-' : ''}${unsigned.slice(0, firstSignificantIndex)}`;
  const rest = unsigned.slice(firstSignificantIndex);
  return { leading, rest };
}

function readInitialTopFootprintMode(): TokenCostMode {
  if (typeof window === 'undefined') {
    return 'tokens';
  }
  try {
    const stored = window.localStorage.getItem(TOKEN_COST_MODE_STORAGE_KEY);
    return stored === 'usd' ? 'usd' : 'tokens';
  } catch {
    return 'tokens';
  }
}

function LabelWithHelp({ label, help, className }: { label: string; help: string; className?: string }) {
  const styles = useStyles2(getStyles);
  return (
    <span className={cx(styles.labelWithHelp, className)}>
      {label}
      <Tooltip content={help}>
        <span aria-label={`${label} help`}>
          <Icon name="info-circle" size="sm" className={styles.helpIcon} />
        </span>
      </Tooltip>
    </span>
  );
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

export default function AgentsPage({
  dataSource = defaultAgentsDataSource,
  dashboardDataSource = defaultDashboardDataSource,
}: AgentsPageProps) {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [items, setItems] = useState<AgentListItem[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  const [activeTab, setActiveTab] = useState<AgentsPageTab>('info');
  const [topFootprintMode, setTopFootprintMode] = useState<TokenCostMode>(() => readInitialTopFootprintMode());
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const rawFrom = 'now-1h';
    const rawTo = 'now';
    return {
      from: dateTimeParse(rawFrom),
      to: dateTimeParse(rawTo),
      raw: { from: rawFrom, to: rawTo },
    };
  });
  const requestVersion = useRef(0);
  const inFlightLoadMore = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const telemetryFromSec = Math.floor(timeRange.from.valueOf() / 1000);
  const telemetryToSec = Math.floor(timeRange.to.valueOf() / 1000);
  const telemetryRangeDuration = useMemo(
    () => computeRangeDuration(telemetryFromSec, telemetryToSec),
    [telemetryFromSec, telemetryToSec]
  );
  const usageByModelAndType = usePrometheusQuery(
    dashboardDataSource,
    tokensByModelAndTypeQuery(emptyFilters, telemetryRangeDuration, 'agent'),
    telemetryFromSec,
    telemetryToSec,
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
    try {
      window.localStorage.setItem(TOKEN_COST_MODE_STORAGE_KEY, topFootprintMode);
      window.dispatchEvent(
        new CustomEvent(TOKEN_COST_MODE_CHANGE_EVENT, {
          detail: { storageKey: TOKEN_COST_MODE_STORAGE_KEY, mode: topFootprintMode },
        })
      );
    } catch {
      // Ignore storage write errors in restricted environments.
    }
  }, [topFootprintMode]);

  useEffect(() => {
    function onModeChange(event: Event) {
      const customEvent = event as CustomEvent<{ storageKey?: string; mode?: TokenCostMode }>;
      if (customEvent.detail?.storageKey !== TOKEN_COST_MODE_STORAGE_KEY) {
        return;
      }
      if (customEvent.detail.mode === 'tokens' || customEvent.detail.mode === 'usd') {
        setTopFootprintMode(customEvent.detail.mode);
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== TOKEN_COST_MODE_STORAGE_KEY) {
        return;
      }
      setTopFootprintMode(event.newValue === 'usd' ? 'usd' : 'tokens');
    }

    window.addEventListener(TOKEN_COST_MODE_CHANGE_EVENT, onModeChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TOKEN_COST_MODE_CHANGE_EVENT, onModeChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

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

  const handleOpenAgent = (item: AgentListItem) => {
    const route =
      item.agent_name.trim().length > 0
        ? buildAgentDetailByNameRoute(item.agent_name)
        : buildAnonymousAgentDetailRoute();
    void navigate(`${PLUGIN_BASE}/${route}`);
  };

  const handleTabChange = useCallback(
    (tab: AgentsPageTab) => () => {
      setActiveTab(tab);
    },
    []
  );

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
        // Start loading before the sentinel reaches the viewport edge.
        rootMargin: '200px 0px',
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, loadMore, loading, loadingMore, nextCursor]);

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

          {activeTab === 'info' ? (
            items.length === 0 ? (
              <div className={styles.empty}>
                <Icon name="search" size="xl" />
                <Text color="secondary">No agents matched this search in the current tenant.</Text>
              </div>
            ) : (
              <div className={styles.heroWrap}>
                <PageInsightBar
                  prompt="Analyze this agent fleet overview. Flag concentration risks, anomalies in usage patterns, or agents that need attention."
                  origin="sigil-plugin/agents-insight"
                  dataContext={agentInsightDataContext}
                />
                <section className={styles.hero} aria-label="agents hero summary">
                  <div className={styles.heroKpis}>
                    <div className={styles.heroKpiCard}>
                      <LabelWithHelp
                        label="Agents"
                        help="Number of loaded agents with latest_seen_at inside the selected time range."
                        className={styles.heroKpiLabel}
                      />
                      <span className={styles.heroKpiValue}>{summary.seenInRangeCount.toLocaleString()}</span>
                    </div>
                    <div className={styles.heroKpiCard}>
                      <LabelWithHelp
                        label="Total generations"
                        help="Sum of generation_count for loaded agents with runtime token usage in the selected time range."
                        className={styles.heroKpiLabel}
                      />
                      <span className={styles.heroKpiValue}>{summary.totalGenerations.toLocaleString()}</span>
                    </div>
                    <div className={styles.heroKpiCard}>
                      <LabelWithHelp
                        label="Token usage"
                        help="Runtime token usage across loaded agents in the selected time range, grouped by agent name."
                        className={styles.heroKpiLabel}
                      />
                      <span className={styles.heroKpiValue}>
                        <TokenCostBox
                          tokenCount={summary.totalTokens}
                          costUSD={summary.totalCostUSD}
                          ariaLabel="Total runtime token usage"
                        />
                      </span>
                    </div>
                    <div className={styles.heroKpiCard}>
                      <LabelWithHelp
                        label="Avg usage per generation"
                        help="Runtime tokens divided by generations from loaded agents with runtime usage in the selected time range."
                        className={styles.heroKpiLabel}
                      />
                      <span className={styles.heroKpiValue}>
                        <TokenCostBox
                          tokenCount={summary.averageTokensPerGeneration}
                          costUSD={summary.averageCostPerGenerationUSD}
                          ariaLabel="Average prompt and tools footprint per generation"
                        />
                      </span>
                    </div>
                  </div>

                  <AgentActivityTimeline
                    items={items}
                    timeRange={timeRange}
                    loading={loading}
                    onTimeRangeChange={setTimeRange}
                  />

                  <div className={styles.heroBody}>
                    <div className={styles.heroSection}>
                      <h4 className={styles.heroSectionTitle}>
                        <LabelWithHelp
                          label="Top by generations"
                          help="Top loaded agents ranked by generation_count in descending order."
                        />
                      </h4>
                      <ul className={styles.rankList}>
                        {summary.topByGenerations.map((item) => (
                          <li
                            key={`gen:${item.agent_name}:${item.latest_effective_version}`}
                            className={styles.rankItem}
                          >
                            <button
                              type="button"
                              className={styles.rankButton}
                              onClick={() => handleOpenAgent(item)}
                              aria-label={`open top generation agent ${cardLabel(item)}`}
                            >
                              {item.agent_name.trim().length > 0 ? item.agent_name : 'Unnamed agent bucket'}
                            </button>
                            <span className={styles.rankValue}>{formatCompactNumber(item.generation_count)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className={styles.heroSection}>
                      <div className={styles.heroSectionHeading}>
                        <h4 className={styles.heroSectionTitle}>
                          <LabelWithHelp
                            label="Agent footprint"
                            help="Top loaded agents ranked by runtime token usage in the selected time range."
                          />
                        </h4>
                        <select
                          aria-label="Top prompt and tools display mode"
                          value={topFootprintMode}
                          onChange={(event) => setTopFootprintMode(event.currentTarget.value as TokenCostMode)}
                          className={styles.footprintModeSelect}
                        >
                          <option value="tokens">tokens</option>
                          <option value="usd">USD</option>
                        </select>
                      </div>
                      <ul className={styles.rankList}>
                        {summary.topByTokenFootprint.map((item) => {
                          const usage =
                            summary.usageByName.get(item.agent_name) ?? summary.usageByName.get(item.agent_name.trim());
                          const tokenValue = usage ? usage.tokens : item.token_estimate.total;
                          const costValue = usage ? usage.costUSD : item.token_estimate.total * ESTIMATED_USD_PER_TOKEN;
                          const usdValue = formatUSD(costValue).slice(1);
                          const usdParts = splitMutedZeroPrefix(usdValue);
                          return (
                            <li
                              key={`tok:${item.agent_name}:${item.latest_effective_version}`}
                              className={styles.rankItem}
                            >
                              <button
                                type="button"
                                className={styles.rankButton}
                                onClick={() => handleOpenAgent(item)}
                                aria-label={`open top token agent ${cardLabel(item)}`}
                              >
                                {item.agent_name.trim().length > 0 ? item.agent_name : 'Unnamed agent bucket'}
                              </button>
                              <span className={styles.rankValue}>
                                {topFootprintMode === 'usd' ? (
                                  <>
                                    <span className={styles.rankValueAffix}>$</span>
                                    {usdParts.leading.length > 0 && (
                                      <span className={styles.rankValueMuted}>{usdParts.leading}</span>
                                    )}
                                    <span className={styles.rankValueNumber}>
                                      {usdParts.rest.length > 0 ? usdParts.rest : '0'}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className={styles.rankValueNumber}>
                                      {Math.round(tokenValue).toLocaleString()}
                                    </span>{' '}
                                    <span className={styles.rankValueAffix}>tokens</span>
                                  </>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className={styles.heroSection}>
                      <h4 className={styles.heroSectionTitle}>
                        <LabelWithHelp
                          label="Risk and health"
                          help="Quick risk signals derived from loaded agents: anonymous naming, stale recency, and version churn."
                        />
                      </h4>
                      <ul className={styles.riskList}>
                        <li className={styles.riskItem}>
                          <span className={styles.riskValue}>{summary.anonymousCount.toLocaleString()}</span>
                          <LabelWithHelp
                            label="anonymous buckets"
                            help="Count of loaded rows where agent_name is empty and grouped as unnamed bucket."
                            className={styles.riskLabel}
                          />
                        </li>
                        <li className={styles.riskItem}>
                          <span className={styles.riskValue}>{summary.staleCount.toLocaleString()}</span>
                          <LabelWithHelp
                            label="stale (> 7 days)"
                            help="Count of loaded agents whose latest_seen_at is more than 7 days older than the selected range end."
                            className={styles.riskLabel}
                          />
                        </li>
                        <li className={styles.riskItem}>
                          <span className={styles.riskValue}>{summary.highChurnCount.toLocaleString()}</span>
                          <LabelWithHelp
                            label={`high churn (${HIGH_CHURN_THRESHOLD}+ versions)`}
                            help={`Count of loaded agents with version_count >= ${HIGH_CHURN_THRESHOLD}.`}
                            className={styles.riskLabel}
                          />
                        </li>
                      </ul>
                    </div>
                  </div>
                </section>
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
                              <td className={cx(styles.td, styles.centeredColumn)}>
                                {item.generation_count.toLocaleString()}
                              </td>
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
            </>
          )}
        </>
      )}
    </div>
  );
}
