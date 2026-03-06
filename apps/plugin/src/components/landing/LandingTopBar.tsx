import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { useAssistant } from '@grafana/assistant';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Card, Icon, IconButton, LinkButton, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
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
import { bucketValues, normalizeValuesToHeights } from '../../utils/seriesBuckets';
import {
  buildSigilAssistantContextItems,
  buildSigilAssistantPrompt,
  withSigilProjectContextFallback,
} from '../../content/assistantContext';
import { defaultEvaluationDataSource } from '../../evaluation/api';
import { useFilterUrlState } from '../../hooks/useFilterUrlState';
import { ideTabs, buildCursorPromptDeeplink, downloadTextFile, renderIdeActionLogo } from '../../ide/ideUtils';
import { PipelineConnectorSwarm } from './PipelineConnectorSwarm';

type IdeKey = InstrumentationPromptIde;

export type HeroStatItem = {
  label: string;
  route: string;
  cta: string;
  current: number;
  previous: number;
  loading: boolean;
  sparklineData?: number[];
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
  compact?: boolean;
  onHeroStats?: (stats: HeroStatItem[]) => void;
  spineHeights?: number[];
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

const TYPEWRITER_PROMPTS = [
  'How do I instrument my app with Sigil?',
  'What is Sigil and how does it work?',
  'How do I set up evaluation rules?',
  'What telemetry does Sigil collect?',
  'How do I connect my LLM provider?',
  'What SDKs are available?',
];
const TYPEWRITER_TYPE_MS = 45;
const TYPEWRITER_PAUSE_MS = 2500;
const TYPEWRITER_DELETE_MS = 25;

function useTypewriterPlaceholder(paused: boolean): string {
  const [text, setText] = useState('');
  const stateRef = useRef({ promptIndex: 0, charIndex: 0, deleting: false });

  useEffect(() => {
    if (paused) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const state = stateRef.current;
      const prompt = TYPEWRITER_PROMPTS[state.promptIndex];

      if (!state.deleting) {
        if (state.charIndex < prompt.length) {
          state.charIndex += 1;
          setText(prompt.slice(0, state.charIndex));
          timer = setTimeout(tick, TYPEWRITER_TYPE_MS);
        } else {
          state.deleting = true;
          timer = setTimeout(tick, TYPEWRITER_PAUSE_MS);
        }
      } else {
        if (state.charIndex > 0) {
          state.charIndex -= 1;
          setText(prompt.slice(0, state.charIndex));
          timer = setTimeout(tick, TYPEWRITER_DELETE_MS);
        } else {
          state.deleting = false;
          state.promptIndex = (state.promptIndex + 1) % TYPEWRITER_PROMPTS.length;
          timer = setTimeout(tick, TYPEWRITER_TYPE_MS * 4);
        }
      }
    };

    timer = setTimeout(tick, TYPEWRITER_TYPE_MS * 4);
    return () => clearTimeout(timer);
  }, [paused]);

  return text;
}

export function LandingTopBar({
  assistantOrigin,
  requestsDataSource,
  requestsFilters = emptyFilters,
  requestsFrom,
  requestsTo,
  compact = false,
  onHeroStats,
  spineHeights,
}: LandingTopBarProps) {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();
  const { timeRange } = useFilterUrlState();
  const dashboardFrom = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const dashboardTo = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);
  const from = requestsDataSource ? (requestsFrom ?? dashboardFrom) : (requestsFrom ?? 0);
  const to = requestsDataSource ? (requestsTo ?? dashboardTo) : (requestsTo ?? 0);
  const [assistantInput, setAssistantInput] = useState('');
  const [selectedIde, setSelectedIde] = useState<IdeKey>('cursor');
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const typewriterPlaceholder = useTypewriterPlaceholder(assistantInput.length > 0);
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
    onHeroStats?.(heroStats);
  }, [heroStats, onHeroStats]);

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
    const prompt = buildSigilAssistantPrompt(message);
    if (assistant.openAssistant) {
      if (prompt.length > 0) {
        assistant.openAssistant({
          origin: assistantOrigin,
          prompt,
          context: buildSigilAssistantContextItems(),
          autoSend: true,
        });
      } else {
        assistant.openAssistant({
          origin: assistantOrigin,
        });
      }
      return;
    }

    window.location.href = buildAssistantUrl(withSigilProjectContextFallback(prompt));
  };

  const openAssistant = () => {
    openAssistantWithPrompt(assistantInput);
  };

  const handleAssistantInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (assistantInput.trim().length === 0) {
      return;
    }
    openAssistant();
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
        const [convCurrentTs, convPreviousTs, agentTs, evalTs] = await Promise.all([
          listConversationTimestamps(currentFrom, currentTo),
          listConversationTimestamps(previousFrom, previousTo),
          listAgentSeenTimestamps(),
          listEvaluatorUpdatedTimestamps(),
        ]);

        if (cancelled) {
          return;
        }

        const currentMin = currentFrom.getTime();
        const currentMax = currentTo.getTime();
        const agentCounts = countInWindows(agentTs, currentFrom, currentTo, previousFrom, previousTo);
        const evaluatorCounts = countInWindows(evalTs, currentFrom, currentTo, previousFrom, previousTo);

        const next: HeroStatItem[] = [
          {
            label: 'Conversations',
            route: ROUTES.Conversations,
            cta: 'View conversations',
            current: convCurrentTs.length,
            previous: convPreviousTs.length,
            loading: false,
            sparklineData: timestampsToSparkline(convCurrentTs, currentMin, currentMax),
          },
          {
            label: 'Agents',
            route: ROUTES.Agents,
            cta: 'Inspect agents',
            current: agentCounts.current,
            previous: agentCounts.previous,
            loading: false,
            sparklineData: timestampsToSparkline(agentTs, currentMin, currentMax),
          },
          {
            label: 'Evaluations',
            route: ROUTES.Evaluation,
            cta: 'Manage evals',
            current: evaluatorCounts.current,
            previous: evaluatorCounts.previous,
            loading: false,
            sparklineData: timestampsToSparkline(evalTs, currentMin, currentMax),
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
            sparklineData: animationTo[index].sparklineData,
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
    let hasCached = cached != null && cached.heights.length > 0 && cached.values.length > 0;

    queueMicrotask(() => {
      if (hasCached && cached) {
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
          hasCached = true;
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

  const fallbackHeights = useMemo(() => {
    const MIN_H = 20;
    const MAX_H = 100;
    return Array.from({ length: spineCount }, (_, i) => {
      const t = i / (spineCount - 1);
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t - 0.5));
      return MIN_H + (MAX_H - MIN_H) * wave;
    });
  }, [spineCount]);

  const displayHeights = useMemo(() => {
    if (requestSpineHeights && requestSpineHeights.length > 0) {
      return requestSpineHeights;
    }
    if (!spineHeights || spineHeights.length === 0) {
      return fallbackHeights;
    }
    return normalizeToSpineHeights(spineHeights, spineCount);
  }, [requestSpineHeights, spineHeights, spineCount, fallbackHeights]);
  const showRequestSpines = requestsDataSource != null && to > from;

  if (compact) {
    return (
      <div className={styles.compactBar}>
        {showRequestSpines && (
          <div className={styles.compactSpines} aria-hidden>
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
        )}
      </div>
    );
  }

  return (
    <>
      <div className={styles.responsiveContainer}>
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
                      : requestSpineHeights == null &&
                          requestsDataSource != null &&
                          requestSpineWaveReason === 'no-data'
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
                          requestSpineHeights != null && !disableSpineAnimation
                            ? `${Math.min(i * 6, 150)}ms`
                            : undefined,
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
                <div className={styles.githubButtonWrap}>
                  <LinkButton
                    className={styles.githubButton}
                    href="https://github.com/grafana/sigil"
                    icon="github"
                    variant="secondary"
                    fill="text"
                    size="sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={styles.githubLabel}>grafana/sigil</span>
                  </LinkButton>
                </div>
                <div className={styles.heroHeader}>
                  <div className={styles.heroHeaderTitle}>
                    <div className={styles.introducingLabel}>Introducing</div>
                    <h1 className={styles.productHeading}>Grafana Sigil</h1>
                  </div>
                </div>
                <div>
                  <div className={styles.heroSubRow}>
                    <Text color="secondary">Actually useful AI O11y</Text>
                  </div>
                </div>
                <div className={styles.heroPipeline}>
                  <div className={styles.pipelineStep}>
                    <PipelineConnectorSwarm
                      color="#5794F2"
                      mode="section"
                      className={styles.pipelineStepSwarm}
                      delaySec={0.1}
                      seed={101}
                    />
                    <div
                      className={styles.pipelineStepAccent}
                      style={{ background: 'linear-gradient(90deg, #5794F2 0%, #73B9FF 100%)' }}
                    />
                    <div className={styles.pipelineStepInner}>
                      <div className={styles.pipelineStepHeader}>
                        <div
                          className={styles.pipelineStepIcon}
                          style={{ color: '#5794F2', background: 'rgba(87, 148, 242, 0.12)' }}
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                          </svg>
                        </div>
                        <div className={styles.pipelineStepTitle}>Instrument</div>
                      </div>
                      <Text variant="h5">Zero-config tracing</Text>
                      <Text color="secondary" variant="body">
                        Drop-in SDKs for Go, Python, TypeScript, Java, and .NET. Capture every LLM call, token, and
                        latency.
                      </Text>
                    </div>
                  </div>
                  <PipelineConnectorSwarm color="#5794F2" />
                  <div className={styles.pipelineStep}>
                    <PipelineConnectorSwarm
                      color="#B877D9"
                      mode="section"
                      className={styles.pipelineStepSwarm}
                      delaySec={0.35}
                      seed={202}
                    />
                    <div
                      className={styles.pipelineStepAccent}
                      style={{ background: 'linear-gradient(90deg, #B877D9 0%, #D4A5F5 100%)' }}
                    />
                    <div className={styles.pipelineStepInner}>
                      <div className={styles.pipelineStepHeader}>
                        <div
                          className={styles.pipelineStepIcon}
                          style={{ color: '#B877D9', background: 'rgba(184, 119, 217, 0.12)' }}
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </div>
                        <div className={styles.pipelineStepTitle}>Observe</div>
                      </div>
                      <Text variant="h5">AI observability</Text>
                      <Text color="secondary" variant="body">
                        Track latency, tokens, cost, and errors across providers and models. Follow conversations,
                        agents, and generations in real time.
                      </Text>
                    </div>
                  </div>
                  <PipelineConnectorSwarm color="#B877D9" delayed />
                  <div className={styles.pipelineStep}>
                    <PipelineConnectorSwarm
                      color="#FF9830"
                      mode="section"
                      className={styles.pipelineStepSwarm}
                      delaySec={0.65}
                      seed={303}
                    />
                    <div
                      className={styles.pipelineStepAccent}
                      style={{ background: 'linear-gradient(90deg, #FF9830 0%, #FFB870 100%)' }}
                    />
                    <div className={styles.pipelineStepInner}>
                      <div className={styles.pipelineStepHeader}>
                        <div
                          className={styles.pipelineStepIcon}
                          style={{ color: '#FF9830', background: 'rgba(255, 152, 48, 0.12)' }}
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                        </div>
                        <div className={styles.pipelineStepTitle}>Evaluate</div>
                      </div>
                      <Text variant="h5">Automatic quality scoring</Text>
                      <Text color="secondary" variant="body">
                        Use LLM judges, regex, JSON schema, or custom heuristics. Turn quality signals into dashboards
                        and alerts.
                      </Text>
                    </div>
                  </div>
                </div>
                <form
                  className={styles.assistantRowDash}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (assistantInput.trim().length === 0) {
                      return;
                    }
                    openAssistant();
                  }}
                >
                  <textarea
                    value={assistantInput}
                    onChange={(event) => setAssistantInput(event.currentTarget.value)}
                    onKeyDown={handleAssistantInputKeyDown}
                    placeholder={typewriterPlaceholder}
                    className={styles.assistantInput}
                    rows={1}
                  />
                  <IconButton
                    name="enter"
                    variant="secondary"
                    size="lg"
                    aria-label="Send"
                    tooltip="Send"
                    className={styles.askSubmitButton}
                    disabled={assistantInput.trim().length === 0}
                    type="button"
                    onClick={openAssistant}
                  />
                </form>
              </div>
            </div>
          </div>

          <div className={styles.heroSideHeaderBlock}>
            <div className={styles.videoCard}>
              <div className={styles.videoPreview}>
                <div className={styles.videoPlayIcon} data-play-icon="">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <div className={styles.videoComingSoon}>
                  <Text color="secondary" variant="bodySmall">
                    Video coming soon
                  </Text>
                </div>
              </div>
            </div>
            <div className={styles.sideActions}>
              <LinkButton
                href={`${PLUGIN_BASE}/${ROUTES.Tutorial}`}
                icon="play"
                variant="primary"
                fill="outline"
                className={styles.sideActionButton}
              >
                Start tutorial
              </LinkButton>
              <LinkButton
                href="https://github.com/grafana/sigil#readme"
                icon="book-open"
                variant="secondary"
                target="_blank"
                rel="noreferrer"
                className={styles.sideActionButton}
              >
                Read docs
              </LinkButton>
            </div>
            <Card className={styles.heroSideCard}>
              <Stack direction="column" gap={2}>
                <div className={styles.sideCardMutedHeading}>
                  <Text color="secondary">AUTOINSTRUMENTATION</Text>
                  <Tooltip
                    content="We provide skills and prompts that guide AI to do the instrumentation work for you."
                    placement="top"
                  >
                    <span className={styles.sideCardInfoIcon} aria-label="Autoinstrumentation help">
                      <Icon name="info-circle" size="sm" />
                    </span>
                  </Tooltip>
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
              <div className={styles.modalHeader}>
                <div className={styles.modalTitleRow}>
                  <span className={styles.modalTitleLogo}>{selectedIdeConfig.logo}</span>
                  <div className={styles.modalHeadingBlock}>
                    <span className={styles.modalKicker}>AUTOINSTRUMENTATION</span>
                    <Text element="h4">{`with ${selectedIdeConfig.label}`}</Text>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.modalCloseButton}
                  aria-label="Close instrumentation dialog"
                  onClick={() => setIsAgentModalOpen(false)}
                >
                  X
                </Button>
              </div>
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
              </div>
              <div className={styles.modalActionRow}>
                <span className={styles.modalDisclaimer}>AI can make mistakes, always check your work.</span>
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
                </div>
              </div>
            </Stack>
          </div>
        </div>
      )}
    </>
  );
}

async function listConversationTimestamps(from: Date, to: Date): Promise<number[]> {
  let cursor = '';
  let pages = 0;
  const timestamps: number[] = [];
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
    for (const conv of response.conversations) {
      timestamps.push(Date.parse(conv.first_generation_at));
    }
    if (!response.has_more || !response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return timestamps;
}

type WindowCounts = {
  current: number;
  previous: number;
};

const SPARKLINE_BUCKETS = 16;

function timestampsToSparkline(timestamps: number[], fromMs: number, toMs: number): number[] {
  const range = toMs - fromMs;
  if (range <= 0) {
    return [];
  }
  const buckets = new Array<number>(SPARKLINE_BUCKETS).fill(0);
  for (const ts of timestamps) {
    if (ts < fromMs || ts > toMs) {
      continue;
    }
    const idx = Math.min(Math.floor(((ts - fromMs) / range) * SPARKLINE_BUCKETS), SPARKLINE_BUCKETS - 1);
    buckets[idx] += 1;
  }
  return buckets;
}

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

function normalizeToSpineHeights(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  const bucketed = Array.from({ length: targetCount }, (_, i) => {
    const start = Math.floor((i * values.length) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / targetCount));
    const slice = values.slice(start, end);
    return slice.reduce((acc, v) => acc + v, 0) / slice.length;
  });
  const minVal = Math.min(...bucketed);
  const maxVal = Math.max(...bucketed);
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || Math.abs(maxVal - minVal) < 1e-9) {
    return bucketed.map(() => 60);
  }
  const MIN_H = 20;
  const MAX_H = 100;
  return bucketed.map((v) => MIN_H + ((v - minVal) / (maxVal - minVal)) * (MAX_H - MIN_H));
}

function getStyles(theme: GrafanaTheme2) {
  return {
    compactBar: css({
      label: 'landingTopBar-compactBar',
      height: 28,
      marginBottom: theme.spacing(-3),
    }),
    compactSpines: css({
      label: 'landingTopBar-compactSpines',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'stretch',
      gap: 2,
      height: '100%',
      width: '100%',
      overflow: 'hidden',
      opacity: 0.75,
    }),
    pageFlow: css({
      label: 'landingTopBar-pageFlow',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)',
      alignItems: 'stretch',
      gap: theme.spacing(2),
      boxSizing: 'border-box',
      marginTop: theme.spacing(-2),
      position: 'relative',
      zIndex: 1,
      '@container landing-top-bar (max-width: 1200px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    responsiveContainer: css({
      label: 'landingTopBar-responsiveContainer',
      containerType: 'inline-size',
      containerName: 'landing-top-bar',
      position: 'relative',
      isolation: 'isolate',
      width: '100%',
      minWidth: 0,
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
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      paddingTop: 32,
    }),
    videoCard: css({
      label: 'landingTopBar-videoCard',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      width: '100%',
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      background: theme.colors.background.primary,
      '&:hover': {
        borderColor: theme.colors.primary.border,
        boxShadow: theme.shadows.z2,
      },
      '&:hover [data-play-icon]': {
        transform: 'scale(1.1)',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: 2,
      },
    }),
    videoPreview: css({
      label: 'landingTopBar-videoPreview',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minHeight: 250,
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    }),
    videoPlayIcon: css({
      label: 'landingTopBar-videoPlayIcon',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 72,
      height: 72,
      borderRadius: theme.shape.radius.circle,
      background: 'rgba(255, 255, 255, 0.15)',
      backdropFilter: 'blur(8px)',
      color: '#fff',
      transition: 'transform 0.2s ease',
    }),
    videoComingSoon: css({
      label: 'landingTopBar-videoComingSoon',
      position: 'absolute',
      bottom: theme.spacing(1.5),
      left: '50%',
      transform: 'translateX(-50%)',
      opacity: 0.7,
    }),
    sideActions: css({
      label: 'landingTopBar-sideActions',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(1),
    }),
    sideActionButton: css({
      label: 'landingTopBar-sideActionButton',
      justifyContent: 'center',
    }),
    heroSideCard: css({
      label: 'landingTopBar-heroSideCard',
    }),
    sideCardMutedHeading: css({
      label: 'landingTopBar-sideCardMutedHeading',
      margin: 0,
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontSize: theme.typography.h6.fontSize,
      lineHeight: theme.typography.h6.lineHeight,
      fontWeight: theme.typography.fontWeightBold,
    }),
    sideCardInfoIcon: css({
      display: 'inline-flex',
      alignItems: 'center',
      color: theme.colors.text.secondary,
      cursor: 'help',
    }),
    heroCard: css({
      label: 'landingTopBar-heroCard',
      position: 'relative',
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      paddingTop: theme.spacing(2.5),
      paddingLeft: theme.spacing(3),
      paddingRight: theme.spacing(3),
      background: theme.isDark
        ? `linear-gradient(145deg, ${theme.colors.background.primary} 0%, rgba(22, 27, 45, 0.95) 50%, ${theme.colors.background.secondary} 100%)`
        : `linear-gradient(145deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
      border: `1px solid ${theme.colors.border.weak}`,
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
      borderTop: 'none',
    }),
    heroCardContent: css({
      label: 'landingTopBar-heroCardContent',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    heroHeader: css({
      label: 'landingTopBar-heroHeader',
      position: 'relative',
      paddingRight: theme.spacing(16),
    }),
    heroHeaderTitle: css({
      label: 'landingTopBar-heroHeaderTitle',
      minWidth: 0,
    }),
    introducingLabel: css({
      label: 'landingTopBar-introducingLabel',
      display: 'inline-block',
      marginTop: 0,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      fontWeight: theme.typography.fontWeightBold,
      fontSize: 11,
      lineHeight: 1,
      color: '#5794F2',
      padding: 0,
    }),
    heroSubRow: css({
      label: 'landingTopBar-heroSubRow',
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(2),
      marginTop: '-2px',
    }),
    githubButtonWrap: css({
      label: 'landingTopBar-githubButtonWrap',
      position: 'absolute',
      marginTop: theme.spacing(1.5),
      right: theme.spacing(2),
      zIndex: 1,
    }),
    githubButton: css({
      label: 'landingTopBar-githubButton',
      minWidth: 'auto',
      '& svg': {
        width: 22,
        height: 22,
      },
    }),
    githubLabel: css({
      label: 'landingTopBar-githubLabel',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
    }),
    productHeading: css({
      label: 'landingTopBar-productHeading',
      margin: 0,
      fontFamily: theme.typography.fontFamily,
      fontWeight: theme.typography.fontWeightBold,
      fontSize: '2.4rem',
      lineHeight: 1.1,
      whiteSpace: 'nowrap',
      color: theme.colors.text.primary,
    }),
    heroPipeline: css({
      label: 'landingTopBar-heroPipeline',
      display: 'flex',
      alignItems: 'stretch',
      gap: 0,
      marginTop: theme.spacing(1.5),
      flex: 1,
      minHeight: 0,
      position: 'relative',
      isolation: 'isolate',
      '@container landing-top-bar (max-width: 900px)': {
        flexDirection: 'column',
        gap: theme.spacing(1),
      },
    }),
    pipelineStep: css({
      label: 'landingTopBar-pipelineStep',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      overflow: 'hidden',
      '& > *': {
        position: 'relative',
        zIndex: 1,
      },
      transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
      '&:hover': {
        borderColor: theme.colors.border.medium,
      },
      '@container landing-top-bar (max-width: 900px)': {
        flex: 'none',
      },
    }),
    pipelineStepSwarm: css({
      label: 'landingTopBar-pipelineStepSwarm',
      inset: 0,
      mixBlendMode: theme.isDark ? 'screen' : 'normal',
      '&&': {
        opacity: 0.08,
        zIndex: 2,
      },
    }),
    pipelineStepAccent: css({
      label: 'landingTopBar-pipelineStepAccent',
      height: 3,
      width: '100%',
      flexShrink: 0,
    }),
    pipelineStepInner: css({
      label: 'landingTopBar-pipelineStepInner',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      padding: theme.spacing(1.5),
    }),
    pipelineStepHeader: css({
      label: 'landingTopBar-pipelineStepHeader',
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    pipelineStepIcon: css({
      label: 'landingTopBar-pipelineStepIcon',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      width: 36,
      height: 36,
      borderRadius: theme.shape.radius.default,
    }),
    pipelineStepTitle: css({
      label: 'landingTopBar-pipelineStepTitle',
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.3,
    }),
    assistantRowDash: css({
      label: 'landingTopBar-assistantRowDash',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: theme.spacing(1),
      width: `calc(100% + ${theme.spacing(6)})`,
      marginLeft: theme.spacing(-3),
      marginRight: theme.spacing(-3),
      marginTop: 'auto',
      alignItems: 'center',
      borderTop: `1px solid ${theme.colors.border.weak}`,
      paddingTop: theme.spacing(1.5),
      paddingRight: theme.spacing(3),
      paddingBottom: theme.spacing(1.5),
      paddingLeft: theme.spacing(3),
    }),
    assistantInput: css({
      label: 'landingTopBar-assistantInput',
      width: '100%',
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: theme.spacing(0.75),
      paddingBottom: theme.spacing(0.75),
      minHeight: 0,
      maxHeight: 80,
      resize: 'none',
      overflowY: 'auto',
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
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
      color: theme.colors.text.primary,
      '--ide-logo-size': '28px',
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
    modalTitleRow: css({
      label: 'landingTopBar-modalTitleRow',
      display: 'inline-flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1.5),
    }),
    modalHeader: css({
      label: 'landingTopBar-modalHeader',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing(2),
      marginTop: theme.spacing(-0.5),
    }),
    modalHeadingBlock: css({
      label: 'landingTopBar-modalHeadingBlock',
      display: 'grid',
      gap: theme.spacing(0.5),
      minWidth: 0,
    }),
    modalKicker: css({
      label: 'landingTopBar-modalKicker',
      margin: 0,
      color: theme.colors.text.secondary,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.2,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    modalTitleLogo: css({
      label: 'landingTopBar-modalTitleLogo',
      display: 'inline-flex',
      alignItems: 'center',
      color: theme.colors.text.primary,
      '--ide-logo-size': '72px',
      '& svg, & img, & span': {
        display: 'block',
      },
    }),
    modalCloseButton: css({
      label: 'landingTopBar-modalCloseButton',
      minWidth: 'auto',
      padding: 0,
      lineHeight: 1,
      fontWeight: theme.typography.fontWeightBold,
      fontSize: theme.typography.h4.fontSize,
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      color: theme.colors.text.secondary,
      marginTop: theme.spacing(-0.5),
      '&:hover': {
        background: 'transparent',
        border: 'none',
        color: theme.colors.text.primary,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
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
      display: 'block',
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
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1.5),
    }),
    modalDisclaimer: css({
      label: 'landingTopBar-modalDisclaimer',
      flex: 1,
      textAlign: 'left',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
    }),
    instrumentButtonLogo: css({
      label: 'landingTopBar-instrumentButtonLogo',
      display: 'inline-flex',
      alignItems: 'center',
      color: theme.colors.text.primary,
      '--ide-logo-size': '14px',
      marginRight: theme.spacing(0.5),
    }),
  };
}
