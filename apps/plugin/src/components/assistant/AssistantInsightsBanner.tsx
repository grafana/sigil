import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import * as Assistant from '@grafana/assistant';
import { useStyles2 } from '@grafana/ui';

export type AssistantInsightsBannerProps = {
  prompt: string;
  origin: string;
  systemPrompt: string;
  dataContext: string | null;
  className?: string;
  waitingText?: string;
  emptyText?: string;
  invalidText?: string;
};

const TYPEWRITER_SPEED_MS = 20;
const INSIGHT_PAUSE_MS = 6000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const AGE_PREFIX_TICK_MS = 60 * 1000;
const CACHE_KEY_PREFIX = 'sigil.assistant-insights-banner.v1';
const TYPED_HISTORY_STORAGE_KEY = `${CACHE_KEY_PREFIX}:typed-history`;

type InsightItem = {
  text: string;
  generatedAt: number;
};

type CachedInsights = {
  generatedAt: number;
  insights: string[];
};

export default function AssistantInsightsBanner({
  prompt,
  origin,
  systemPrompt,
  dataContext,
  className,
}: AssistantInsightsBannerProps) {
  const styles = useStyles2(getStyles);
  const assistant = Assistant.useInlineAssistant();
  const fullAssistant = Assistant.useAssistant();
  const [, setRawAssistantText] = useState('');
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [currentInsightIndex, setCurrentInsightIndex] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [ageTick, setAgeTick] = useState(() => Date.now());
  const [typedHistory, setTypedHistory] = useState<Record<string, true>>(() => readTypedHistory());
  const latestRef = useRef({ prompt, origin, systemPrompt, assistant });
  const lastDataContextRef = useRef<string | null>(null);

  useEffect(() => {
    latestRef.current = { prompt, origin, systemPrompt, assistant };
  });

  const resetInsights = useCallback(() => {
    setRawAssistantText('');
    setInsights([]);
    setCurrentInsightIndex(0);
    setTypedLength(0);
  }, []);

  const runGenerate = useCallback((context: string, cacheKey: string, fallbackCacheKey: string) => {
    const {
      prompt: currentPrompt,
      origin: currentOrigin,
      systemPrompt: currentSystemPrompt,
      assistant: currentAssistant,
    } = latestRef.current;
    const fullPrompt = [currentPrompt.trim(), '', 'Use the following context as ground truth:', context].join('\n');
    currentAssistant.generate({
      prompt: fullPrompt,
      origin: currentOrigin,
      systemPrompt: currentSystemPrompt,
      onComplete: (result: string) => {
        const generatedAt = Date.now();
        setRawAssistantText(result);
        const parsedInsights = parseInsights(result);
        if (result.trim().length > 0 && parsedInsights.length === 0) {
          console.error('Assistant insights parse failed: no valid insight lines found.');
        }
        setInsights(parsedInsights.map((text) => ({ text, generatedAt })));
        const cacheValue = { generatedAt, insights: parsedInsights };
        writeCachedInsights(cacheKey, cacheValue);
        writeCachedInsights(fallbackCacheKey, cacheValue);
      },
      onError: (err: Error) => {
        console.error('Assistant insights generation failed:', err);
        setRawAssistantText('');
        setInsights([]);
      },
    });
  }, []);

  useEffect(() => {
    if (!dataContext) {
      lastDataContextRef.current = null;
      queueMicrotask(() => resetInsights());
      return;
    }
    if (assistant.isGenerating) {
      return;
    }
    if (lastDataContextRef.current === dataContext) {
      return;
    }
    const cacheKey = buildCacheKey(prompt, origin, systemPrompt, dataContext);
    const fallbackCacheKey = buildFallbackCacheKey(prompt, origin, systemPrompt);
    const cached = readCachedInsights(cacheKey) ?? readCachedInsights(fallbackCacheKey);
    if (cached) {
      queueMicrotask(() => {
        setRawAssistantText(cached.insights.join('\n'));
        setInsights(cached.insights.map((text) => ({ text, generatedAt: cached.generatedAt })));
        setCurrentInsightIndex(0);
        setTypedLength(0);
        setTypedHistory((prev) => {
          const next = mergeTypedHistory(prev, cached.insights);
          if (next === prev) {
            return prev;
          }
          writeTypedHistory(next);
          return next;
        });
      });
    } else {
      queueMicrotask(() => resetInsights());
    }
    lastDataContextRef.current = dataContext;
    const cacheAgeMs = cached ? Date.now() - cached.generatedAt : Number.POSITIVE_INFINITY;
    if (cacheAgeMs >= REFRESH_INTERVAL_MS) {
      runGenerate(dataContext, cacheKey, fallbackCacheKey);
    }
  }, [assistant.isGenerating, dataContext, origin, prompt, resetInsights, runGenerate, systemPrompt]);

  useEffect(() => {
    if (!dataContext) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (!latestRef.current.assistant.isGenerating) {
        const cacheKey = buildCacheKey(prompt, origin, systemPrompt, dataContext);
        const fallbackCacheKey = buildFallbackCacheKey(prompt, origin, systemPrompt);
        runGenerate(dataContext, cacheKey, fallbackCacheKey);
      }
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [dataContext, origin, prompt, runGenerate, systemPrompt]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setAgeTick(Date.now());
    }, AGE_PREFIX_TICK_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const currentInsight = insights[currentInsightIndex];
  const currentInsightText = currentInsight?.text ?? '';
  const currentInsightTypedKey = useMemo(() => {
    if (!currentInsightText.length) {
      return '';
    }
    return buildTypedInsightKey(currentInsightText);
  }, [currentInsightText]);
  const hasTypedCurrentInsight = currentInsightTypedKey.length > 0 && Boolean(typedHistory[currentInsightTypedKey]);
  const typedInsight = useMemo(() => currentInsightText.slice(0, typedLength), [currentInsightText, typedLength]);
  const hasMultipleInsights = insights.length > 1;
  const isCurrentInsightComplete = currentInsightText.length > 0 && typedLength >= currentInsightText.length;
  const currentInsightAgeMs = currentInsight ? Math.max(ageTick - currentInsight.generatedAt, 0) : 0;
  const showAgePrefix = currentInsightAgeMs >= REFRESH_INTERVAL_MS;
  const agePrefixText = showAgePrefix ? `${formatAgePrefix(currentInsightAgeMs)}: ` : '';

  useEffect(() => {
    if (!currentInsightText.length) {
      queueMicrotask(() => setTypedLength(0));
      return;
    }
    queueMicrotask(() => setTypedLength(hasTypedCurrentInsight ? currentInsightText.length : 0));
  }, [currentInsightText, hasTypedCurrentInsight]);

  useEffect(() => {
    if (!currentInsightText.length || !currentInsightTypedKey.length || typedLength < currentInsightText.length) {
      return;
    }
    if (typedHistory[currentInsightTypedKey]) {
      return;
    }
    queueMicrotask(() =>
      setTypedHistory((prev) => {
        if (prev[currentInsightTypedKey]) {
          return prev;
        }
        const next: Record<string, true> = { ...prev, [currentInsightTypedKey]: true };
        writeTypedHistory(next);
        return next;
      })
    );
  }, [currentInsightText, currentInsightTypedKey, typedHistory, typedLength]);

  useEffect(() => {
    if (!isHovered || !currentInsightText.length) {
      return;
    }
    queueMicrotask(() => setTypedLength(currentInsightText.length));
  }, [currentInsightText, isHovered]);

  useEffect(() => {
    if (!currentInsightText.length || isHovered) {
      return;
    }
    let nextLength = typedLength;
    let pauseTimeoutId: number | undefined;
    if (nextLength >= currentInsightText.length) {
      if (insights.length > 1) {
        pauseTimeoutId = window.setTimeout(() => {
          setCurrentInsightIndex((prev) => (prev + 1) % insights.length);
        }, INSIGHT_PAUSE_MS);
      }
      return () => {
        if (pauseTimeoutId !== undefined) {
          window.clearTimeout(pauseTimeoutId);
        }
      };
    }
    const typeInterval = window.setInterval(() => {
      nextLength += 1;
      setTypedLength(nextLength);
      if (nextLength >= currentInsightText.length) {
        window.clearInterval(typeInterval);
        pauseTimeoutId = window.setTimeout(() => {
          if (insights.length <= 1) {
            setTypedLength(currentInsightText.length);
            return;
          }
          setCurrentInsightIndex((prev) => (prev + 1) % insights.length);
        }, INSIGHT_PAUSE_MS);
      }
    }, TYPEWRITER_SPEED_MS);
    return () => {
      window.clearInterval(typeInterval);
      if (pauseTimeoutId !== undefined) {
        window.clearTimeout(pauseTimeoutId);
      }
    };
  }, [currentInsightText, insights.length, isHovered, typedLength]);

  useEffect(() => {
    const cursorInterval = window.setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 520);
    return () => {
      window.clearInterval(cursorInterval);
    };
  }, []);

  const hasInsights = insights.length > 0;
  const onPrevious = useCallback(() => {
    if (!hasMultipleInsights) {
      return;
    }
    setCurrentInsightIndex((prev) => (prev - 1 + insights.length) % insights.length);
  }, [hasMultipleInsights, insights.length]);
  const onNext = useCallback(() => {
    if (!hasMultipleInsights) {
      return;
    }
    setCurrentInsightIndex((prev) => (prev + 1) % insights.length);
  }, [hasMultipleInsights, insights.length]);
  const onExplain = useCallback(() => {
    const insight = currentInsightText.trim();
    if (!insight.length || !fullAssistant.openAssistant) {
      return;
    }
    const explainPrompt = [
      'Explain this dashboard insight very briefly.',
      'Start with the basics in 1-2 short sentences.',
      'Then give only 2-3 concise bullets for likely causes, impact, and next checks.',
      'Keep the full response under 120 words.',
      '',
      `Insight: ${insight}`,
    ].join('\n');
    fullAssistant.openAssistant({
      origin,
      prompt: explainPrompt,
      autoSend: true,
    });
  }, [currentInsightText, fullAssistant, origin]);

  return (
    <div
      className={cx(styles.banner, className)}
      aria-label="assistant insights banner"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {hasInsights ? (
        <div className={styles.contentRow}>
          <span className={styles.sparkleIcon} title="AI generated insights" aria-label="AI generated insights">
            ✨
          </span>
          <p className={cx(styles.text, isHovered ? styles.textExpanded : undefined)}>
            {showAgePrefix ? <span className={styles.agePrefix}>{agePrefixText}</span> : null}
            {typedInsight}
            <span className={styles.cursor} aria-hidden="true">
              {showCursor ? '|' : ' '}
            </span>
          </p>
          {isCurrentInsightComplete ? (
            <button type="button" className={styles.explainLink} onClick={onExplain}>
              Explain
            </button>
          ) : null}
          {hasMultipleInsights ? (
            <div className={styles.controls}>
              <button type="button" className={styles.controlButton} onClick={onPrevious} aria-label="Previous insight">
                &lt;
              </button>
              <button type="button" className={styles.controlButton} onClick={onNext} aria-label="Next insight">
                &gt;
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className={styles.placeholder} />
      )}
    </div>
  );
}

function parseInsights(rawAssistantText: string): string[] {
  return rawAssistantText
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function buildCacheKey(prompt: string, origin: string, systemPrompt: string, dataContext: string): string {
  const keySource = `${origin}|${prompt}|${systemPrompt}|${dataContext}`;
  return `${CACHE_KEY_PREFIX}:${stableHash(keySource)}`;
}

function buildFallbackCacheKey(prompt: string, origin: string, systemPrompt: string): string {
  const keySource = `${origin}|${prompt}|${systemPrompt}`;
  return `${CACHE_KEY_PREFIX}:fallback:${stableHash(keySource)}`;
}

function readCachedInsights(cacheKey: string): CachedInsights | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedInsights(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedInsights(cacheKey: string, value: CachedInsights): void {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(value));
  } catch {
    // Ignore quota and storage availability failures.
  }
}

function buildTypedInsightKey(insightText: string): string {
  const keySource = insightText.trim().replace(/\s+/g, ' ').toLowerCase();
  return stableHash(keySource);
}

function mergeTypedHistory(history: Record<string, true>, insights: string[]): Record<string, true> {
  const keys = insights.map((insight) => buildTypedInsightKey(insight));
  let changed = false;
  const next = { ...history };
  for (const key of keys) {
    if (!next[key]) {
      next[key] = true;
      changed = true;
    }
  }
  return changed ? next : history;
}

function readTypedHistory(): Record<string, true> {
  try {
    const raw = window.localStorage.getItem(TYPED_HISTORY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(([, value]) => value === true);
    return Object.fromEntries(entries) as Record<string, true>;
  } catch {
    return {};
  }
}

function writeTypedHistory(value: Record<string, true>): void {
  try {
    window.localStorage.setItem(TYPED_HISTORY_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore quota and storage availability failures.
  }
}

function isCachedInsights(value: unknown): value is CachedInsights {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<CachedInsights>;
  if (typeof candidate.generatedAt !== 'number' || !Array.isArray(candidate.insights)) {
    return false;
  }
  return candidate.insights.every((insight) => typeof insight === 'string');
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function formatAgePrefix(ageMs: number): string {
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

function cx(...classNames: Array<string | undefined>): string {
  return classNames.filter((name): name is string => Boolean(name)).join(' ');
}

function getStyles(theme: GrafanaTheme2) {
  return {
    banner: css({
      width: '100%',
      padding: theme.spacing(0.5, 0),
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(1),
      display: 'flex',
      alignItems: 'flex-start',
    }),
    contentRow: css({
      width: '100%',
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
      minWidth: 0,
    }),
    sparkleIcon: css({
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
      fontSize: 18,
      width: theme.spacing(2.75),
      textAlign: 'center',
      userSelect: 'none',
      cursor: 'default',
      filter: 'grayscale(1) saturate(0)',
      opacity: 0.85,
      transition: 'filter 120ms ease, opacity 120ms ease',
      '&:hover': {
        filter: 'grayscale(0) saturate(1)',
        opacity: 1,
      },
    }),
    text: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.5,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      width: '100%',
    }),
    agePrefix: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      marginRight: theme.spacing(0.5),
    }),
    textExpanded: css({
      whiteSpace: 'normal',
      overflow: 'visible',
      textOverflow: 'clip',
    }),
    controls: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      flexShrink: 0,
    }),
    explainLink: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.secondary,
      padding: 0,
      margin: 0,
      cursor: 'pointer',
      fontSize: theme.typography.bodySmall.fontSize,
      textDecoration: 'underline',
      flexShrink: 0,
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
    controlButton: css({
      border: 'none',
      background: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
      borderRadius: theme.shape.radius.default,
      width: 24,
      height: 24,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      lineHeight: 1,
      fontSize: theme.typography.bodySmall.fontSize,
      padding: 0,
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
    cursor: css({
      color: theme.colors.text.secondary,
    }),
    placeholder: css({
      margin: 0,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      color: theme.colors.text.secondary,
    }),
  };
}
