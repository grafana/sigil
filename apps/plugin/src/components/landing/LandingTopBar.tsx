import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { useAssistant } from '@grafana/assistant';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Card, HorizontalGroup, IconButton, LinkButton, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { useNavigate } from 'react-router-dom';
import { defaultAgentsDataSource } from '../../agents/api';
import { defaultConversationsDataSource } from '../../conversation/api';
import { PLUGIN_BASE, ROUTES } from '../../constants';
import {
  getInstrumentationPrompt,
  getInstrumentationPromptFilename,
  type InstrumentationPromptIde,
} from '../../content/cursorInstrumentationPrompt';
import type { DashboardDataSource } from '../../dashboard/api';
import { computeRateInterval, computeStep, requestsOverTimeQuery } from '../../dashboard/queries';
import {
  type DashboardFilters,
  type PrometheusMatrixResult,
  type PrometheusQueryResponse,
  emptyFilters,
} from '../../dashboard/types';
import { defaultEvaluationDataSource } from '../../evaluation/api';
import { useFilterUrlState } from '../../hooks/useFilterUrlState';
import { ideTabs, buildCursorPromptDeeplink, downloadTextFile, renderIdeActionLogo } from '../../ide/ideUtils';

type IdeKey = InstrumentationPromptIde;

type HeroStatItem = {
  label: string;
  route: string;
  cta: string;
  current: number;
  previous: number;
  loading: boolean;
};

const METRIC_WINDOW_MS = 24 * 60 * 60 * 1000;
const TOP_BAR_REFRESH_INTERVAL_MS = 70 * 1000; // 1 min 10 sec
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const HERO_STATS_STORAGE_KEY = 'grafana-sigil-hero-stats';
const HERO_STATS_ANIMATION_MS = 600;
const REQUEST_SPINE_STORAGE_KEY = 'grafana-sigil-request-spine';
const REQUEST_SPINE_CACHE_TTL_MS = 15 * 60 * 1000;

type StoredHeroStats = {
  fetched_at?: number;
  conversations: { current: number; previous: number };
  agents: { current: number; previous: number };
  evaluations: { current: number; previous: number };
};

type HeroStatsCache = {
  stats: HeroStatItem[];
  fetchedAt?: number;
};

type StoredRequestSpine = {
  fetched_at: number;
  key: string;
  heights: number[];
  values: number[];
};

function readHeroStatsCache(): HeroStatsCache | null {
  try {
    const raw = localStorage.getItem(HERO_STATS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredHeroStats;
    if (parsed?.conversations && parsed?.agents && parsed?.evaluations) {
      return {
        fetchedAt: parsed.fetched_at,
        stats: [
          {
            label: 'Conversations',
            route: ROUTES.Conversations,
            cta: 'View conversations',
            ...parsed.conversations,
            loading: false,
          },
          {
            label: 'Agents',
            route: ROUTES.Agents,
            cta: 'Inspect agents',
            ...parsed.agents,
            loading: false,
          },
          {
            label: 'Evaluations',
            route: ROUTES.Evaluation,
            cta: 'Manage evals',
            ...parsed.evaluations,
            loading: false,
          },
        ],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildRequestSpineCacheKey(query: string, from: number, to: number, spineCount: number): string {
  // Use query + duration so relative ranges (for example "last 6h") can reuse
  // cached bars across quick refreshes while still revalidating immediately.
  return JSON.stringify({
    query,
    durationSec: Math.max(0, Math.floor(to - from)),
    spineCount,
  });
}

function readRequestSpineFromStorage(key: string): { heights: number[]; values: number[] } | null {
  try {
    const raw = localStorage.getItem(REQUEST_SPINE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredRequestSpine;
    if (
      parsed?.key !== key ||
      !Array.isArray(parsed.heights) ||
      !Array.isArray(parsed.values) ||
      typeof parsed.fetched_at !== 'number'
    ) {
      return null;
    }
    if (Date.now() - parsed.fetched_at > REQUEST_SPINE_CACHE_TTL_MS) {
      return null;
    }
    return {
      heights: parsed.heights.filter((value) => Number.isFinite(value)).map((value) => Number(value)),
      values: parsed.values.filter((value) => Number.isFinite(value)).map((value) => Number(value)),
    };
  } catch {
    return null;
  }
}

function saveRequestSpineToStorage(key: string, heights: number[], values: number[]): void {
  try {
    const stored: StoredRequestSpine = {
      fetched_at: Date.now(),
      key,
      heights,
      values,
    };
    localStorage.setItem(REQUEST_SPINE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // ignore
  }
}

function loadHeroStatsFromStorage(): HeroStatItem[] | null {
  const cached = readHeroStatsCache();
  if (!cached) {
    return null;
  }
  return cached.stats;
}

export function shouldFetchHeroStats(now = Date.now()): boolean {
  const cached = readHeroStatsCache();
  if (!cached?.fetchedAt) {
    return true;
  }
  // Always revalidate in the background so cached stats render instantly
  // while still converging to fresh backend values.
  return now - cached.fetchedAt >= 0;
}

function saveHeroStatsToStorage(stats: HeroStatItem[]): void {
  try {
    const [conv, agents, evals] = stats;
    if (conv?.loading || agents?.loading || evals?.loading) {
      return;
    }
    const stored: StoredHeroStats = {
      fetched_at: Date.now(),
      conversations: { current: conv.current, previous: conv.previous },
      agents: { current: agents.current, previous: agents.previous },
      evaluations: { current: evals.current, previous: evals.previous },
    };
    localStorage.setItem(HERO_STATS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // ignore
  }
}

function interpolateHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function buildFakeDocUrl(pathname: string): string {
  return new URL(pathname, 'https://docs.example.com').toString();
}

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}

type LandingTopBarProps = {
  assistantOrigin: string;
  requestsDataSource?: DashboardDataSource;
  requestsFilters?: DashboardFilters;
  requestsFrom?: number;
  requestsTo?: number;
};

function extractRequestsSeries(response: PrometheusQueryResponse): number[] {
  if (response.status !== 'success' || response.data.resultType !== 'matrix') {
    return [];
  }
  const [series] = response.data.result as PrometheusMatrixResult[];
  if (!series?.values) {
    return [];
  }
  return series.values
    .map(([, value]) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function formatBarTime(fromSec: number, toSec: number, index: number, count: number): string {
  const range = toSec - fromSec;
  const tsSec = fromSec + ((index + 0.5) / count) * range;
  const date = new Date(tsSec * 1000);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBarDuration(fromSec: number, toSec: number, count: number): string {
  const durationSec = (toSec - fromSec) / count;
  if (durationSec >= 86400) {
    return `${Math.round(durationSec / 86400)}d`;
  }
  if (durationSec >= 3600) {
    return `${Math.round(durationSec / 3600)}h`;
  }
  if (durationSec >= 60) {
    return `${Math.round(durationSec / 60)}m`;
  }
  return `${Math.round(durationSec)}s`;
}

function formatRequestStat(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0 req/s';
  }
  if (value >= 100) {
    return `${Math.round(value).toLocaleString()} req/s`;
  }
  if (value >= 1) {
    return `${value.toFixed(2)} req/s`;
  }
  return `${value.toFixed(3)} req/s`;
}

function bucketValues(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  return Array.from({ length: targetCount }, (_, i) => {
    const start = Math.floor((i * values.length) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / targetCount));
    const slice = values.slice(start, end);
    const sum = slice.reduce((acc, value) => acc + value, 0);
    return sum / slice.length;
  });
}

function normalizeValuesToHeights(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  const bucketed = bucketValues(values, targetCount);
  const minValue = Math.min(...bucketed);
  const maxValue = Math.max(...bucketed);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return [];
  }
  if (Math.abs(maxValue - minValue) < 1e-9) {
    return bucketed.map(() => 60);
  }
  const minHeight = 20;
  const maxHeight = 100;
  return bucketed.map((value) => {
    const t = (value - minValue) / (maxValue - minValue);
    return minHeight + t * (maxHeight - minHeight);
  });
}

export function LandingTopBar({
  assistantOrigin,
  requestsDataSource,
  requestsFilters = emptyFilters,
  requestsFrom,
  requestsTo,
}: LandingTopBarProps) {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();
  const navigate = useNavigate();
  const { timeRange } = useFilterUrlState();
  const dashboardFrom = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const dashboardTo = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);
  const from = requestsDataSource ? (requestsFrom ?? dashboardFrom) : (requestsFrom ?? 0);
  const to = requestsDataSource ? (requestsTo ?? dashboardTo) : (requestsTo ?? 0);
  const [assistantInput, setAssistantInput] = useState('');
  const [selectedIde, setSelectedIde] = useState<IdeKey>('cursor');
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [heroStats, setHeroStats] = useState<HeroStatItem[]>(() => {
    const stored = loadHeroStatsFromStorage();
    if (stored) {
      return stored;
    }
    return [
      {
        label: 'Conversations',
        route: ROUTES.Conversations,
        cta: 'View conversations',
        current: 0,
        previous: 0,
        loading: true,
      },
      { label: 'Agents', route: ROUTES.Agents, cta: 'Inspect agents', current: 0, previous: 0, loading: true },
      { label: 'Evaluations', route: ROUTES.Evaluation, cta: 'Manage evals', current: 0, previous: 0, loading: true },
    ];
  });
  const heroStatsRef = useRef(heroStats);
  const heroStatsAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    heroStatsRef.current = heroStats;
  }, [heroStats]);

  useEffect(() => {
    return () => {
      if (heroStatsAnimationFrameRef.current != null) {
        cancelAnimationFrame(heroStatsAnimationFrameRef.current);
      }
    };
  }, []);

  const selectedIdeConfig = useMemo(() => ideTabs.find((ide) => ide.key === selectedIde) ?? ideTabs[0], [selectedIde]);
  const selectedPrompt = useMemo(() => getInstrumentationPrompt(selectedIde), [selectedIde]);
  const cursorDeeplink = useMemo(() => buildCursorPromptDeeplink(selectedPrompt), [selectedPrompt]);

  const openAssistantWithPrompt = (message: string) => {
    const prompt = message.trim();
    if (assistant.openAssistant) {
      if (prompt.length > 0) {
        assistant.openAssistant({
          origin: assistantOrigin,
          prompt,
          autoSend: true,
        });
      } else {
        assistant.openAssistant({
          origin: assistantOrigin,
        });
      }
      return;
    }

    window.location.href = buildAssistantUrl(prompt);
  };

  const openAssistant = () => {
    openAssistantWithPrompt(assistantInput);
  };

  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      const now = Date.now();
      if (!shouldFetchHeroStats(now)) {
        return;
      }

      const currentFrom = new Date(now - METRIC_WINDOW_MS);
      const currentTo = new Date(now);
      const previousFrom = new Date(now - 2 * METRIC_WINDOW_MS);
      const previousTo = new Date(now - METRIC_WINDOW_MS);

      try {
        const [conversationCurrent, conversationPrevious, agentCounts, evaluatorCounts] = await Promise.all([
          countConversationsInRange(currentFrom, currentTo),
          countConversationsInRange(previousFrom, previousTo),
          countAgentsSeenInWindows(currentFrom, currentTo, previousFrom, previousTo),
          countEvaluatorsUpdatedInWindows(currentFrom, currentTo, previousFrom, previousTo),
        ]);

        if (cancelled) {
          return;
        }

        const next = [
          {
            label: 'Conversations',
            route: ROUTES.Conversations,
            cta: 'View conversations',
            current: conversationCurrent,
            previous: conversationPrevious,
            loading: false,
          },
          {
            label: 'Agents',
            route: ROUTES.Agents,
            cta: 'Inspect agents',
            current: agentCounts.current,
            previous: agentCounts.previous,
            loading: false,
          },
          {
            label: 'Evaluations',
            route: ROUTES.Evaluation,
            cta: 'Manage evals',
            current: evaluatorCounts.current,
            previous: evaluatorCounts.previous,
            loading: false,
          },
        ];
        if (heroStatsAnimationFrameRef.current != null) {
          cancelAnimationFrame(heroStatsAnimationFrameRef.current);
          heroStatsAnimationFrameRef.current = null;
        }

        const previous = heroStatsRef.current;
        const canAnimate =
          previous.length === next.length &&
          previous.every((item, index) => item.label === next[index].label && !item.loading && !next[index].loading);
        const hasValueChange = previous.some(
          (item, index) => item.current !== next[index].current || item.previous !== next[index].previous
        );

        if (!canAnimate || !hasValueChange) {
          setHeroStats(next);
          saveHeroStatsToStorage(next);
          return;
        }

        const animationStart = performance.now();
        const animationFrom = previous.map((item) => ({ ...item }));
        const animationTo = next.map((item) => ({ ...item }));
        const animate = (timestamp: number) => {
          const elapsed = timestamp - animationStart;
          const progress = Math.min(1, elapsed / HERO_STATS_ANIMATION_MS);
          const eased = 1 - Math.pow(1 - progress, 3);
          const frame = animationFrom.map((item, index) => ({
            ...item,
            current: Math.round(item.current + (animationTo[index].current - item.current) * eased),
            previous: Math.round(item.previous + (animationTo[index].previous - item.previous) * eased),
            loading: false,
          }));
          setHeroStats(frame);

          if (progress < 1) {
            heroStatsAnimationFrameRef.current = requestAnimationFrame(animate);
            return;
          }

          heroStatsAnimationFrameRef.current = null;
          setHeroStats(animationTo);
          saveHeroStatsToStorage(animationTo);
        };

        heroStatsAnimationFrameRef.current = requestAnimationFrame(animate);
      } catch {
        if (cancelled) {
          return;
        }
        // Fall back to the existing values so the hero stats do not stay in a loading state forever.
        setHeroStats((prev) => prev.map((item) => ({ ...item, loading: false })));
      }
    };

    void loadStats();

    const intervalId = setInterval(() => {
      void loadStats();
    }, TOP_BAR_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const gradientColors = ['#5794F2', '#B877D9', '#FF9830'] as const;
  const spineCount = 48;
  const initialRequestSpineCache = useMemo(() => {
    if (!requestsDataSource || to <= from) {
      return null;
    }
    const step = computeStep(from, to);
    const interval = computeRateInterval(step);
    const query = requestsOverTimeQuery(requestsFilters, interval, 'none');
    const cacheKey = buildRequestSpineCacheKey(query, from, to, spineCount);
    const cached = readRequestSpineFromStorage(cacheKey);
    if (!cached || cached.heights.length === 0 || cached.values.length === 0) {
      return null;
    }
    return cached;
  }, [requestsDataSource, requestsFilters, from, to, spineCount]);
  const [requestSpineHeights, setRequestSpineHeights] = useState<number[] | null>(
    () => initialRequestSpineCache?.heights ?? null
  );
  const [requestSpineValues, setRequestSpineValues] = useState<number[] | null>(
    () => initialRequestSpineCache?.values ?? null
  );
  const [disableSpineAnimation, setDisableSpineAnimation] = useState<boolean>(() => initialRequestSpineCache != null);
  const [requestSpineWaveReason, setRequestSpineWaveReason] = useState<null | 'loading' | 'no-data' | 'error'>(() =>
    requestsDataSource && to > from && initialRequestSpineCache == null ? 'loading' : null
  );

  useEffect(() => {
    if (!requestsDataSource || to <= from) {
      queueMicrotask(() => {
        setDisableSpineAnimation(false);
        setRequestSpineHeights(null);
        setRequestSpineValues(null);
        setRequestSpineWaveReason(null);
      });
      return;
    }
    let cancelled = false;
    const step = computeStep(from, to);
    const interval = computeRateInterval(step);
    const query = requestsOverTimeQuery(requestsFilters, interval, 'none');
    const cacheKey = buildRequestSpineCacheKey(query, from, to, spineCount);
    const cached = readRequestSpineFromStorage(cacheKey);
    const hasCached = cached != null && cached.heights.length > 0 && cached.values.length > 0;

    queueMicrotask(() => {
      if (hasCached) {
        setDisableSpineAnimation(true);
        setRequestSpineHeights(cached.heights);
        setRequestSpineValues(cached.values);
        setRequestSpineWaveReason(null);
      } else {
        setDisableSpineAnimation(false);
        setRequestSpineWaveReason('loading');
      }
    });

    const loadRequestBars = async () => {
      try {
        const response = await requestsDataSource.queryRange(query, from, to, step);
        if (cancelled) {
          return;
        }
        const values = extractRequestsSeries(response);
        const nextHeights = normalizeValuesToHeights(values, spineCount);
        const nextValues = bucketValues(values, spineCount);
        if (nextHeights.length > 0) {
          setRequestSpineWaveReason(null);
          saveRequestSpineToStorage(cacheKey, nextHeights, nextValues);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!cancelled) {
                setDisableSpineAnimation(false);
                setRequestSpineHeights(nextHeights);
                setRequestSpineValues(nextValues);
              }
            });
          });
        } else {
          if (hasCached) {
            return;
          }
          setRequestSpineHeights(null);
          setRequestSpineValues(null);
          setRequestSpineWaveReason('no-data');
        }
      } catch {
        if (!cancelled) {
          if (hasCached) {
            return;
          }
          setRequestSpineHeights(null);
          setRequestSpineValues(null);
          setRequestSpineWaveReason('error');
        }
      }
    };

    void loadRequestBars();

    const intervalId = setInterval(() => {
      void loadRequestBars();
    }, TOP_BAR_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [requestsDataSource, requestsFilters, from, to, spineCount]);

  const waveAt75Heights = useMemo(() => {
    const MIN_H = 20;
    const MAX_H = 100;
    return Array.from({ length: spineCount }, (_, i) => {
      const t = i / (spineCount - 1);
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t - 0.5));
      return MIN_H + (MAX_H - MIN_H) * wave;
    });
  }, [spineCount]);

  const displayHeights = requestSpineHeights ?? waveAt75Heights;
  const showRequestSpines = requestsDataSource != null && to > from;

  return (
    <>
      <div className={styles.pageFlow}>
        <div className={styles.heroBlock}>
          {showRequestSpines ? (
            <div className={styles.heroSpines} aria-hidden>
              {displayHeights.map((height, i) => {
                const t = i / (spineCount - 1);
                const color =
                  t <= 0.52
                    ? interpolateHex(gradientColors[0], gradientColors[1], t / 0.52)
                    : interpolateHex(gradientColors[1], gradientColors[2], (t - 0.52) / 0.48);
                const stat =
                  requestSpineValues != null && i < requestSpineValues.length
                    ? formatRequestStat(requestSpineValues[i])
                    : null;
                const timeStr = stat != null && to > from ? formatBarTime(from, to, i, spineCount) : null;
                const durationStr = stat != null && to > from ? formatBarDuration(from, to, spineCount) : null;
                const waveIssueTooltip =
                  requestSpineHeights == null && requestsDataSource != null && requestSpineWaveReason === 'error'
                    ? 'Failed to load request data'
                    : requestSpineHeights == null && requestsDataSource != null && requestSpineWaveReason === 'no-data'
                      ? 'No data in this time range'
                      : null;
                const tooltipContent =
                  stat != null ? (
                    <div className={styles.spineTooltipContent}>
                      <div>{stat}</div>
                      {timeStr != null && <div className={styles.spineTooltipTime}>{timeStr}</div>}
                      {durationStr != null && <div className={styles.spineTooltipTime}>({durationStr})</div>}
                    </div>
                  ) : waveIssueTooltip != null ? (
                    waveIssueTooltip
                  ) : null;
                const bar = (
                  <div
                    className={styles.heroSpine}
                    style={{
                      transform: `scaleY(${height / 100})`,
                      backgroundColor: color,
                      transition: disableSpineAnimation ? 'none' : undefined,
                      transitionDelay:
                        requestSpineHeights != null && !disableSpineAnimation ? `${Math.min(i * 6, 150)}ms` : undefined,
                    }}
                  />
                );
                const slot = <div className={styles.heroSpineSlot}>{bar}</div>;
                return (
                  <Tooltip key={i} content={tooltipContent ?? ''} placement="top">
                    {slot}
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <div className={styles.heroSpinesSpacer} aria-hidden />
          )}
          <div className={cx(styles.heroCard, showRequestSpines && styles.heroCardWithSpines)}>
            <div className={styles.heroCardContent}>
              <div className={styles.heroHeader}>
                <div>
                  <div className={styles.introducingLabel}>Introducing</div>
                  <h1 className={styles.productHeading}>Grafana Sigil</h1>
                  <Text color="secondary">Actually useful AI O11y</Text>
                </div>
                <ul className={styles.heroLearnMoreList}>
                  {heroStats.map((item) => (
                    <li key={item.label}>
                      <button
                        type="button"
                        className={styles.heroStatLink}
                        onClick={() => void navigate(`${PLUGIN_BASE}/${item.route}`)}
                      >
                        <span className={styles.heroStatLabel}>{item.label}</span>
                        <span className={styles.heroStatRow}>
                          <span className={styles.heroStatValue}>
                            {item.loading ? '...' : item.current.toLocaleString()}
                          </span>
                          {!item.loading && (
                            <ComparisonBadge current={item.current} previous={item.previous} styles={styles} />
                          )}
                        </span>
                        <span className={styles.heroStatCta}>{item.cta}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <form className={styles.assistantRowDash}>
                <textarea
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.currentTarget.value)}
                  placeholder="Ask me anything about Sigil"
                  className={styles.assistantInput}
                  rows={3}
                />
                <IconButton
                  name="enter"
                  variant="secondary"
                  size="lg"
                  aria-label="Send"
                  tooltip="Send"
                  className={styles.askSubmitButton}
                  disabled={assistantInput.trim().length === 0}
                  onClick={openAssistant}
                  type="button"
                />
              </form>
            </div>
          </div>
        </div>

        <div className={styles.heroSideHeaderBlock}>
          <HorizontalGroup className={styles.heroSideActions}>
            <LinkButton href={`${PLUGIN_BASE}/${ROUTES.Tutorial}`} icon="play" variant="primary">
              Tutorial (NEW)
            </LinkButton>
            <LinkButton
              href={buildFakeDocUrl('/sigil/get-started')}
              icon="book-open"
              variant="secondary"
              target="_blank"
              rel="noreferrer"
            >
              Read docs
            </LinkButton>
          </HorizontalGroup>
          <Card className={styles.heroSideCard}>
            <Stack direction="column" gap={2}>
              <div className={styles.sideCardMutedHeading}>
                <Text color="secondary">AUTOINSTRUMENTATION</Text>
              </div>
              <Text color="secondary">
                Use our coding agent skill to instrument your codebase. Then select coding agent.
              </Text>
              <div className={styles.ideTabs}>
                {ideTabs.map((ide) => (
                  <button
                    key={ide.key}
                    type="button"
                    className={styles.ideTabButton}
                    onClick={() => {
                      setSelectedIde(ide.key);
                      setIsAgentModalOpen(true);
                    }}
                    aria-label={`Open ${ide.label} instrumentation details`}
                  >
                    <span className={styles.ideTabLogo}>{ide.logo}</span>
                    <span>{ide.label}</span>
                  </button>
                ))}
              </div>
            </Stack>
          </Card>
        </div>
      </div>

      {isAgentModalOpen && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setIsAgentModalOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedIdeConfig.label} instrumentation`}
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <Stack direction="column" gap={2}>
              <HorizontalGroup justify="space-between">
                <Text element="h4">{selectedIdeConfig.label}</Text>
                <Button variant="secondary" size="sm" onClick={() => setIsAgentModalOpen(false)}>
                  Close
                </Button>
              </HorizontalGroup>
              <Text>{selectedIdeConfig.blurb}</Text>
              {selectedIdeConfig.tips.length > 0 && (
                <ul className={styles.bulletList}>
                  {selectedIdeConfig.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
              <div className={styles.promptSummaryRow}>
                <div className={styles.promptContent}>
                  <pre className={styles.promptPreview}>
                    <code>{selectedPrompt}</code>
                  </pre>
                </div>
                <div className={styles.promptIconActions}>
                  <IconButton
                    name="download-alt"
                    variant="secondary"
                    aria-label="Download prompt file"
                    tooltip="Download prompt as a markdown file"
                    className={styles.promptIconButton}
                    onClick={() => downloadTextFile(getInstrumentationPromptFilename(selectedIde), selectedPrompt)}
                  />
                  <IconButton
                    name="copy"
                    variant="secondary"
                    aria-label="Copy prompt to clipboard"
                    tooltip="Copy prompt to your clipboard"
                    className={styles.promptIconButton}
                    onClick={() => void navigator.clipboard.writeText(selectedPrompt)}
                  />
                </div>
              </div>
              <HorizontalGroup justify="flex-end" className={styles.modalActionRow}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (selectedIde === 'cursor') {
                      window.open(cursorDeeplink, '_blank', 'noopener');
                      return;
                    }
                    void navigator.clipboard.writeText(selectedPrompt);
                  }}
                >
                  <span className={styles.instrumentButtonLogo}>{renderIdeActionLogo(selectedIde)}</span>
                  {selectedIde === 'cursor' ? 'Instrument in Cursor' : 'Copy prompt'}
                </Button>
              </HorizontalGroup>
            </Stack>
          </div>
        </div>
      )}
    </>
  );
}

function ComparisonBadge({
  current,
  previous,
  styles,
}: {
  current: number;
  previous: number;
  styles: ReturnType<typeof getStyles>;
}) {
  if (previous === 0 && current === 0) {
    return (
      <Tooltip content="No change from previous window" placement="bottom">
        <span className={`${styles.changeBadge} ${styles.changeBadgeNeutral}`}>→ 0%</span>
      </Tooltip>
    );
  }

  if (previous === 0) {
    return null;
  }

  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  const isUp = pctChange > 0;
  const arrow = pctChange === 0 ? '→' : isUp ? '↑' : '↓';
  const sign = isUp ? '+' : '';
  const badgeClass =
    pctChange === 0 ? styles.changeBadgeNeutral : isUp ? styles.changeBadgeGood : styles.changeBadgeWarn;
  const tooltipText = `${previous.toLocaleString()} in previous window`;
  return (
    <Tooltip content={tooltipText} placement="bottom">
      <span className={`${styles.changeBadge} ${badgeClass}`}>
        {arrow} {sign}
        {pctChange.toFixed(1)}%
      </span>
    </Tooltip>
  );
}

async function countConversationsInRange(from: Date, to: Date): Promise<number> {
  let cursor = '';
  let total = 0;
  let pages = 0;
  while (pages < MAX_PAGES) {
    const response = await defaultConversationsDataSource.searchConversations({
      filters: '',
      select: [],
      time_range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      page_size: PAGE_SIZE,
      cursor: cursor.length > 0 ? cursor : undefined,
    });
    total += response.conversations.length;
    if (!response.has_more || !response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return total;
}

type WindowCounts = {
  current: number;
  previous: number;
};

function countInWindows(
  timestamps: number[],
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date
): WindowCounts {
  const currentMin = currentFrom.getTime();
  const currentMax = currentTo.getTime();
  const previousMin = previousFrom.getTime();
  const previousMax = previousTo.getTime();
  let current = 0;
  let previous = 0;

  for (const timestamp of timestamps) {
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    if (timestamp >= currentMin && timestamp <= currentMax) {
      current += 1;
      continue;
    }
    if (timestamp >= previousMin && timestamp <= previousMax) {
      previous += 1;
    }
  }

  return { current, previous };
}

async function listAgentSeenTimestamps(): Promise<number[]> {
  let cursor = '';
  let pages = 0;
  const timestamps: number[] = [];
  while (pages < MAX_PAGES) {
    const response = await defaultAgentsDataSource.listAgents(PAGE_SIZE, cursor);
    for (const item of response.items ?? []) {
      timestamps.push(Date.parse(item.latest_seen_at));
    }
    if (!response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return timestamps;
}

async function listEvaluatorUpdatedTimestamps(): Promise<number[]> {
  let cursor = '';
  let pages = 0;
  const timestamps: number[] = [];
  while (pages < MAX_PAGES) {
    const response = await defaultEvaluationDataSource.listEvaluators(PAGE_SIZE, cursor);
    for (const item of response.items ?? []) {
      timestamps.push(Date.parse(item.updated_at));
    }
    if (!response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return timestamps;
}

export async function countAgentsSeenInWindows(
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date
): Promise<WindowCounts> {
  const timestamps = await listAgentSeenTimestamps();
  return countInWindows(timestamps, currentFrom, currentTo, previousFrom, previousTo);
}

async function countEvaluatorsUpdatedInWindows(
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date
): Promise<WindowCounts> {
  const timestamps = await listEvaluatorUpdatedTimestamps();
  return countInWindows(timestamps, currentFrom, currentTo, previousFrom, previousTo);
}

function getStyles(theme: GrafanaTheme2) {
  return {
    pageFlow: css({
      label: 'landingTopBar-pageFlow',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(400px, 480px)',
      alignItems: 'stretch',
      gap: theme.spacing(3),
      boxSizing: 'border-box',
      marginTop: theme.spacing(-2),
      '@media (max-width: 1200px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    heroBlock: css({
      label: 'landingTopBar-heroBlock',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
    }),
    heroSpines: css({
      label: 'landingTopBar-heroSpines',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'stretch',
      gap: 2,
      height: 32,
      paddingTop: 0,
      paddingLeft: 0,
      paddingRight: 0,
      overflow: 'hidden',
      opacity: 0.75,
    }),
    heroSpinesSpacer: css({
      label: 'landingTopBar-heroSpinesSpacer',
      height: 32,
      flexShrink: 0,
    }),
    heroSpineSlot: css({
      label: 'landingTopBar-heroSpineSlot',
      flex: 1,
      minWidth: 2,
      height: '100%',
      display: 'flex',
      alignItems: 'flex-end',
    }),
    heroSpine: css({
      label: 'landingTopBar-heroSpine',
      width: '100%',
      height: '100%',
      borderTopLeftRadius: 1,
      borderTopRightRadius: 1,
      transformOrigin: 'bottom',
      transition: 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
    }),
    spineTooltipContent: css({
      label: 'landingTopBar-spineTooltipContent',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    spineTooltipTime: css({
      label: 'landingTopBar-spineTooltipTime',
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    heroSideHeaderBlock: css({
      label: 'landingTopBar-heroSideHeaderBlock',
      position: 'sticky',
      top: theme.spacing(2),
      alignSelf: 'stretch',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      gap: theme.spacing(3),
      minHeight: 0,
      '@media (max-width: 1200px)': {
        position: 'static',
      },
    }),
    heroSideActions: css({
      label: 'landingTopBar-heroSideActions',
      margin: 0,
    }),
    heroSideCard: css({
      label: 'landingTopBar-heroSideCard',
      height: '100%',
      minHeight: 0,
    }),
    sideCardMutedHeading: css({
      label: 'landingTopBar-sideCardMutedHeading',
      margin: 0,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontSize: theme.typography.h6.fontSize,
      lineHeight: theme.typography.h6.lineHeight,
      fontWeight: theme.typography.fontWeightBold,
    }),
    heroCard: css({
      label: 'landingTopBar-heroCard',
      position: 'relative',
      flex: 1,
      minHeight: 0,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      paddingTop: theme.spacing(2),
      paddingLeft: theme.spacing(3),
      paddingRight: theme.spacing(3),
      background: `linear-gradient(135deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'linear-gradient(90deg, #5794F2 0%, #B877D9 52%, #FF9830 100%)',
      },
    }),
    heroCardWithSpines: css({
      label: 'landingTopBar-heroCardWithSpines',
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    }),
    heroCardContent: css({
      label: 'landingTopBar-heroCardContent',
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    introducingLabel: css({
      label: 'landingTopBar-introducingLabel',
      marginTop: 0,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.1,
      color: '#5794F2',
    }),
    heroHeader: css({
      label: 'landingTopBar-heroHeader',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'start',
      gap: theme.spacing(2),
      '@media (max-width: 900px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    heroLearnMoreList: css({
      label: 'landingTopBar-heroLearnMoreList',
      margin: 0,
      paddingLeft: 0,
      listStyle: 'none',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, max-content)',
      gap: theme.spacing(0.5),
      justifySelf: 'end',
      alignSelf: 'center',
      '@media (max-width: 900px)': {
        gridTemplateColumns: '1fr',
        justifySelf: 'start',
      },
    }),
    heroStatLink: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      border: 0,
      background: 'none',
      padding: theme.spacing(1, 2),
      borderRadius: theme.shape.radius.default,
      textAlign: 'right',
      cursor: 'pointer',
      '&:hover': {
        background: theme.colors.action.hover,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: 2,
      },
    }),
    heroStatLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightRegular,
      lineHeight: 1.2,
    }),
    heroStatRow: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(1),
    }),
    heroStatValue: css({
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.h3.fontSize,
      lineHeight: 1.2,
    }),
    heroStatCta: css({
      color: theme.colors.text.link,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.2,
    }),
    changeBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(0.25, 1),
      borderRadius: 999,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
      textDecoration: 'none',
    }),
    changeBadgeGood: css({
      color: theme.colors.success.text,
      border: `1px solid ${theme.colors.success.border}`,
      background: theme.colors.success.transparent,
    }),
    changeBadgeWarn: css({
      color: theme.colors.warning.text,
      border: `1px solid ${theme.colors.warning.border}`,
      background: theme.colors.warning.transparent,
    }),
    changeBadgeNeutral: css({
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      background: 'transparent',
    }),
    productHeading: css({
      label: 'landingTopBar-productHeading',
      margin: 0,
      fontFamily: theme.typography.fontFamily,
      fontWeight: theme.typography.fontWeightBold,
      fontSize: '2.2rem',
      lineHeight: 1.1,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
    }),
    assistantRowDash: css({
      label: 'landingTopBar-assistantRowDash',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: theme.spacing(1),
      flex: 1,
      width: `calc(100% + ${theme.spacing(6)})`,
      marginLeft: theme.spacing(-3),
      marginRight: theme.spacing(-3),
      marginTop: 'auto',
      marginBottom: theme.spacing(-2),
      alignItems: 'stretch',
      minHeight: 96,
      borderTop: `1px solid ${theme.colors.border.medium}`,
      paddingTop: theme.spacing(0.75),
      paddingRight: theme.spacing(3),
      paddingBottom: theme.spacing(4.5),
      paddingLeft: theme.spacing(3),
      background: theme.colors.background.secondary,
    }),
    assistantInput: css({
      label: 'landingTopBar-assistantInput',
      width: '100%',
      height: '100%',
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: theme.spacing(0.75),
      paddingBottom: 0,
      minHeight: 56,
      maxHeight: 128,
      resize: 'none',
      overflowY: 'auto',
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.h6.fontSize,
      lineHeight: theme.typography.h6.lineHeight,
      color: theme.colors.text.primary,
      '&::placeholder': {
        color: theme.colors.text.secondary,
      },
      '&:focus': {
        outline: 'none',
        boxShadow: 'none',
      },
    }),
    askSubmitButton: css({
      label: 'landingTopBar-askSubmitButton',
      backgroundColor: theme.colors.action.hover,
      padding: theme.spacing(0.5),
      borderRadius: theme.shape.radius.circle,
      alignSelf: 'end',
      '&:hover::before': {
        borderRadius: theme.shape.radius.circle,
      },
      transition: 'all 0.2s ease-in-out',
    }),
    bulletList: css({
      label: 'landingTopBar-bulletList',
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
    }),
    ideTabs: css({
      label: 'landingTopBar-ideTabs',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: theme.spacing(1),
    }),
    ideTabButton: css({
      label: 'landingTopBar-ideTabButton',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(1),
      cursor: 'pointer',
    }),
    ideTabLogo: css({
      label: 'landingTopBar-ideTabLogo',
      display: 'inline-flex',
      alignItems: 'center',
    }),
    modalBackdrop: css({
      label: 'landingTopBar-modalBackdrop',
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 8, 13, 0.56)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999,
      padding: theme.spacing(2),
    }),
    modalCard: css({
      label: 'landingTopBar-modalCard',
      width: '100%',
      maxWidth: 760,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      padding: theme.spacing(3),
      boxShadow: theme.shadows.z3,
    }),
    promptPreview: css({
      label: 'landingTopBar-promptPreview',
      margin: 0,
      maxHeight: 280,
      overflowY: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      padding: theme.spacing(1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      '& code': {
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    promptSummaryRow: css({
      label: 'landingTopBar-promptSummaryRow',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'start',
      gap: theme.spacing(1),
    }),
    promptContent: css({
      label: 'landingTopBar-promptContent',
      display: 'grid',
      gap: theme.spacing(1),
    }),
    promptIconActions: css({
      label: 'landingTopBar-promptIconActions',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(0.75),
    }),
    promptIconButton: css({
      label: 'landingTopBar-promptIconButton',
      width: 32,
      height: 32,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      color: theme.colors.text.secondary,
      '&:hover': {
        borderColor: theme.colors.border.medium,
        background: theme.colors.action.hover,
      },
      '&:focus-visible': {
        boxShadow: `0 0 0 2px ${theme.colors.primary.main}`,
      },
    }),
    modalActionRow: css({
      label: 'landingTopBar-modalActionRow',
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-end',
    }),
    instrumentButtonLogo: css({
      label: 'landingTopBar-instrumentButtonLogo',
      display: 'inline-flex',
      alignItems: 'center',
      marginRight: theme.spacing(0.5),
      '& svg': {
        width: 20,
        height: 20,
      },
    }),
  };
}
