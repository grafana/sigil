import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Tooltip, useStyles2 } from '@grafana/ui';
import { useAssistant, useInlineAssistant } from '@grafana/assistant';
import { Loader } from '../Loader';
import {
  buildSigilAssistantContextItems,
  buildSigilAssistantPrompt,
  withSigilProjectContextFallback,
} from '../../content/assistantContext';
import { formatInlineMarkup } from './formatInlineMarkup';

export type PageInsightBarProps = {
  prompt: string;
  origin: string;
  dataContext: string | null;
  systemPrompt?: string;
};

const DEFAULT_SYSTEM_PROMPT =
  'You are a concise observability analyst. Return exactly 2-3 high-confidence findings. Each finding is a single short sentence on its own line prefixed with "- ". Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only.';

const STORAGE_KEY = 'sigil.insightBar.collapsed';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const AGE_TICK_MS = 60 * 1000;
const CACHE_KEY_PREFIX = 'sigil.page-insight-bar.v1';
const GENERATE_LOCK_MS = 30 * 1000;
const inFlightGenerateByScopeKey = new Map<string, number>();

/** Clears the generate lock map. Used by tests to ensure isolation. */
export function clearGenerateLockForTests(): void {
  inFlightGenerateByScopeKey.clear();
}

type CachedInsight = {
  generatedAt: number;
  text: string;
};

type LiveInsight = CachedInsight & {
  cacheKey: string;
};

function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // storage unavailable
  }
}

export function PageInsightBar({
  prompt,
  origin,
  dataContext,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}: PageInsightBarProps) {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();
  const gen = useInlineAssistant();
  const [liveInsight, setLiveInsight] = useState<LiveInsight | null>(null);
  const [ageTick, setAgeTick] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const lastRequestKeyRef = useRef<string | null>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  const latestRef = useRef({ prompt, origin, systemPrompt, dataContext, gen });
  useEffect(() => {
    latestRef.current = { prompt, origin, systemPrompt, dataContext, gen };
  });

  const runGenerate = useCallback((ctx: string, cacheKey: string, fallbackCacheKey: string) => {
    const lockKey = fallbackCacheKey;
    const now = Date.now();
    const lastStartedAt = inFlightGenerateByScopeKey.get(lockKey);
    if (lastStartedAt && now - lastStartedAt < GENERATE_LOCK_MS) {
      return;
    }
    inFlightGenerateByScopeKey.set(lockKey, now);

    const { prompt: p, origin: o, systemPrompt: sp, gen: g } = latestRef.current;
    const fullPrompt = `${p}\n\nData context:\n${ctx}`;
    g.generate({
      prompt: fullPrompt,
      origin: o,
      systemPrompt: sp,
      onComplete: (result: string) => {
        inFlightGenerateByScopeKey.delete(lockKey);
        const generatedTs = Date.now();
        const cached: CachedInsight = { generatedAt: generatedTs, text: result };
        setLiveInsight({ ...cached, cacheKey });
        writeCachedInsight(cacheKey, cached);
        writeCachedInsight(fallbackCacheKey, cached);
      },
      onError: (err: Error) => {
        inFlightGenerateByScopeKey.delete(lockKey);
        console.error('Insight generation failed:', err);
      },
    });
  }, []);

  const cacheKey = dataContext ? buildCacheKey(prompt, origin, systemPrompt, dataContext) : null;
  const fallbackCacheKey = dataContext ? buildFallbackCacheKey(prompt, origin, systemPrompt) : null;
  const exactCachedInsight = cacheKey ? readCachedInsight(cacheKey) : null;
  const fallbackCachedInsight = fallbackCacheKey ? readCachedInsight(fallbackCacheKey) : null;
  const newestCachedInsight = pickNewestCachedInsight(exactCachedInsight, fallbackCachedInsight);

  useEffect(() => {
    if (!dataContext || gen.isGenerating) {
      return;
    }
    if (!cacheKey || !fallbackCacheKey) {
      return;
    }
    if (lastRequestKeyRef.current === cacheKey) {
      return;
    }
    const newestCacheAgeMs = newestCachedInsight
      ? Date.now() - newestCachedInsight.generatedAt
      : Number.POSITIVE_INFINITY;
    lastRequestKeyRef.current = cacheKey;
    if (newestCacheAgeMs >= REFRESH_INTERVAL_MS) {
      runGenerate(dataContext, cacheKey, fallbackCacheKey);
    }
  }, [cacheKey, dataContext, fallbackCacheKey, gen.isGenerating, newestCachedInsight, runGenerate]);

  useEffect(() => {
    if (!dataContext) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (latestRef.current.gen.isGenerating) {
        return;
      }
      const cacheKey = buildCacheKey(prompt, origin, systemPrompt, dataContext);
      const fallbackCacheKey = buildFallbackCacheKey(prompt, origin, systemPrompt);
      const exactCached = readCachedInsight(cacheKey);
      const fallbackCached = readCachedInsight(fallbackCacheKey);
      const latestCached = pickNewestCachedInsight(exactCached, fallbackCached);
      const cacheAgeMs = latestCached ? Date.now() - latestCached.generatedAt : Number.POSITIVE_INFINITY;
      if (cacheAgeMs >= REFRESH_INTERVAL_MS) {
        runGenerate(dataContext, cacheKey, fallbackCacheKey);
      }
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [dataContext, origin, prompt, runGenerate, systemPrompt]);

  const doRegenerate = useCallback(() => {
    const { dataContext: ctx, gen: g, prompt: p, origin: o, systemPrompt: sp } = latestRef.current;
    if (ctx && !g.isGenerating) {
      const cacheKey = buildCacheKey(p, o, sp, ctx);
      const fallbackCacheKey = buildFallbackCacheKey(p, o, sp);
      runGenerate(ctx, cacheKey, fallbackCacheKey);
    }
  }, [runGenerate]);

  const explainInsight = useCallback(
    (insight: string) => {
      const question = buildSigilAssistantPrompt(buildExplainPrompt(insight));
      if (assistant.openAssistant) {
        assistant.openAssistant({
          origin,
          prompt: question,
          context: buildSigilAssistantContextItems(),
          autoSend: true,
        });
        return;
      }
      window.location.href = buildAssistantUrl(withSigilProjectContextFallback(question));
    },
    [assistant, origin]
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setAgeTick(Date.now());
    }, AGE_TICK_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const cachedInsight = newestCachedInsight;
  const liveForCurrentContext = cacheKey && liveInsight?.cacheKey === cacheKey ? liveInsight : null;
  const insight = liveForCurrentContext ?? cachedInsight;
  const effectiveText = dataContext ? (insight?.text ?? '') : '';
  const hasStreamingText = gen.content.trim().length > 0;
  const displayText = gen.isGenerating && hasStreamingText ? gen.content : effectiveText;
  const initialWaiting = !dataContext && !gen.isGenerating;
  const hasResult = Boolean(effectiveText) || gen.isGenerating;
  const showLoader = initialWaiting || gen.isGenerating;
  const loaderTooltip = initialWaiting ? 'Waiting for data' : 'Generating insight...';
  const insightAgeLabel = dataContext && insight ? formatAgeShort(Math.max(ageTick - insight.generatedAt, 0)) : null;

  const bullets = useMemo(() => {
    if (!displayText) {
      return [];
    }
    return displayText
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 0);
  }, [displayText]);

  const firstBullet = bullets.length > 0 ? bullets[0] : null;
  const canExpand = bullets.length > 0;
  const isToggleDisabled = collapsed && !canExpand;

  return (
    <div className={collapsed ? styles.barCollapsed : styles.bar} role="complementary" aria-label="Page insight">
      <div className={styles.header}>
        <button
          type="button"
          className={isToggleDisabled ? styles.headerToggleDisabled : styles.headerToggle}
          onClick={isToggleDisabled ? undefined : toggleCollapsed}
          aria-expanded={isToggleDisabled ? undefined : !collapsed}
          aria-label={isToggleDisabled ? 'No insights available' : collapsed ? 'Expand insights' : 'Collapse insights'}
          aria-disabled={isToggleDisabled}
        >
          <Icon name="ai" size="md" className={styles.aiIcon} />
          <span className={styles.headerTitle}>AI analysis</span>
          {collapsed && firstBullet && (
            <span className={styles.collapsedPreview}>{formatInlineMarkup(firstBullet)}</span>
          )}
          {!isToggleDisabled && (
            <Icon name={collapsed ? 'angle-down' : 'angle-up'} size="md" className={styles.chevron} />
          )}
        </button>

        <div className={styles.actions}>
          {showLoader && (
            <Tooltip content={loaderTooltip} placement="top">
              <span className={styles.loaderTooltipTarget}>
                <Loader showText={false} />
              </span>
            </Tooltip>
          )}
          {!gen.isGenerating && hasResult && (
            <>
              {insightAgeLabel && <span className={styles.generatedAtText}>{insightAgeLabel}</span>}
              <IconButton
                name="sync"
                aria-label="Regenerate insight"
                tooltip="Regenerate"
                size="sm"
                onClick={doRegenerate}
              />
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className={styles.body}>
          {initialWaiting || (gen.isGenerating && bullets.length === 0) ? null : bullets.length > 0 ? (
            <ul className={styles.bulletList}>
              {bullets.map((bullet, i) => (
                <li key={i} className={styles.bulletItem}>
                  <span className={styles.bulletArrow}>→</span>
                  <div className={styles.bulletContent}>
                    <span className={styles.bulletText}>{formatInlineMarkup(bullet)}</span>
                    <button type="button" className={styles.explainLink} onClick={() => explainInsight(bullet)}>
                      Explain
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <span className={styles.placeholder}>No notable insights.</span>
          )}
        </div>
      )}
    </div>
  );
}

const COLLAPSED_HEIGHT = 40;
const EXPANDED_HEIGHT = 140;

function buildCacheKey(prompt: string, origin: string, systemPrompt: string, dataContext: string): string {
  const keySource = `${origin}|${prompt}|${systemPrompt}|${dataContext}`;
  return `${CACHE_KEY_PREFIX}:${stableHash(keySource)}`;
}

function buildFallbackCacheKey(prompt: string, origin: string, systemPrompt: string): string {
  const keySource = `${origin}|${prompt}|${systemPrompt}`;
  return `${CACHE_KEY_PREFIX}:fallback:${stableHash(keySource)}`;
}

function readCachedInsight(cacheKey: string): CachedInsight | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedInsight(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedInsight(cacheKey: string, value: CachedInsight): void {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(value));
  } catch {
    // Ignore quota and storage availability failures.
  }
}

function isCachedInsight(value: unknown): value is CachedInsight {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<CachedInsight>;
  return typeof candidate.generatedAt === 'number' && typeof candidate.text === 'string';
}

function pickNewestCachedInsight(
  exactCached: CachedInsight | null,
  fallbackCached: CachedInsight | null
): CachedInsight | null {
  if (!exactCached) {
    return fallbackCached;
  }
  if (!fallbackCached) {
    return exactCached;
  }
  return exactCached.generatedAt >= fallbackCached.generatedAt ? exactCached : fallbackCached;
}

function stableHash(input: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function formatAgeShort(ageMs: number): string {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ageMs < hour) {
    return `${Math.max(1, Math.floor(ageMs / minute))}m`;
  }
  if (ageMs < day) {
    return `${Math.floor(ageMs / hour)}h`;
  }
  return `${Math.floor(ageMs / day)}d`;
}

function buildExplainPrompt(insight: string): string {
  return `Explain this insight briefly in plain language for a user:\n- ${insight}\n\nKeep it concise and specific. Include what it likely means and why it matters. If confidence is limited, add one optional follow-up investigation step.`;
}

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}

function getStyles(theme: GrafanaTheme2) {
  const barBase = {
    width: '100%',
    background: theme.colors.background.secondary,
    overflow: 'hidden' as const,
    marginBottom: theme.spacing(2),
  };

  return {
    bar: css({
      ...barBase,
      height: EXPANDED_HEIGHT,
      display: 'flex',
      flexDirection: 'column',
    }),
    barCollapsed: css({
      ...barBase,
      height: COLLAPSED_HEIGHT,
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(1, 1.5),
      height: COLLAPSED_HEIGHT,
      flexShrink: 0,
    }),
    headerToggle: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: 0,
      minWidth: 0,
      flex: 1,
      color: theme.colors.text.primary,
    }),
    headerToggleDisabled: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      border: 'none',
      background: 'transparent',
      cursor: 'default',
      padding: 0,
      minWidth: 0,
      flex: 1,
      color: theme.colors.text.primary,
    }),
    aiIcon: css({
      flexShrink: 0,
      color: theme.colors.primary.text,
    }),
    headerTitle: css({
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      flexShrink: 0,
    }),
    collapsedPreview: css({
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      minWidth: 0,
      paddingLeft: theme.spacing(1),
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.primary,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    chevron: css({
      flexShrink: 0,
      color: theme.colors.text.secondary,
    }),
    actions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      flexShrink: 0,
    }),
    loaderTooltipTarget: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    generatedAtText: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1,
    }),
    body: css({
      padding: theme.spacing(0, 1.5, 1.5),
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
    }),
    placeholder: css({
      color: theme.colors.text.secondary,
      fontStyle: 'italic',
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    bulletList: css({
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      gap: theme.spacing(1),
      height: '100%',
    }),
    bulletItem: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
      padding: theme.spacing(1.25),
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      flex: '1 1 0%',
      minWidth: 0,
    }),
    bulletContent: css({
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      gap: theme.spacing(0.5),
    }),
    bulletArrow: css({
      flexShrink: 0,
      color: theme.colors.text.disabled,
      fontWeight: theme.typography.fontWeightBold,
      lineHeight: 1.6,
    }),
    bulletText: css({
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.6,
      color: theme.colors.text.secondary,
      display: '-webkit-box',
      WebkitLineClamp: 3,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.canvas,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    explainLink: css({
      alignSelf: 'flex-start',
      border: 'none',
      background: 'transparent',
      color: theme.colors.primary.text,
      padding: 0,
      cursor: 'pointer',
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.2,
      textDecoration: 'underline',
      '&:hover': {
        color: theme.colors.text.primary,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.border}`,
        outlineOffset: theme.spacing(0.25),
      },
    }),
  };
}
