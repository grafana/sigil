import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import type { PromptInsight, PromptInsightsResponse } from '../../agents/types';

export type HighlightedSystemPromptProps = {
  systemPrompt: string;
  insights: PromptInsightsResponse | null;
  className?: string;
  onInsightClick?: (insight: PromptInsight, kind: 'strength' | 'weakness', index: number) => void;
};

export type HighlightedSystemPromptHandle = {
  scrollToInsight: (kind: 'strength' | 'weakness', index: number) => void;
};

type HighlightRange = {
  start: number;
  end: number;
  insight: PromptInsight;
  kind: 'strength' | 'weakness';
  sourceIndex: number;
};

function findHighlightRanges(text: string, insights: PromptInsightsResponse): HighlightRange[] {
  const ranges: HighlightRange[] = [];

  const addRanges = (items: PromptInsight[], kind: 'strength' | 'weakness') => {
    for (let i = 0; i < items.length; i++) {
      const insight = items[i];
      const idx = text.indexOf(insight.quote);
      if (idx === -1) {
        continue;
      }
      ranges.push({ start: idx, end: idx + insight.quote.length, insight, kind, sourceIndex: i });
    }
  };

  addRanges(insights.strengths, 'strength');
  addRanges(insights.weaknesses, 'weakness');

  ranges.sort((a, b) => a.start - b.start);

  const merged: HighlightRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) {
      continue;
    }
    merged.push(range);
  }

  return merged;
}

type MarkerPosition = {
  topPercent: number;
  kind: 'strength' | 'weakness';
  insight: PromptInsight;
  sourceIndex: number;
};

export const HighlightedSystemPrompt = forwardRef<HighlightedSystemPromptHandle, HighlightedSystemPromptProps>(
  function HighlightedSystemPrompt({ systemPrompt, insights, className, onInsightClick }, ref) {
    const styles = useStyles2(getStyles);
    const preRef = useRef<HTMLPreElement>(null);
    const [markers, setMarkers] = useState<MarkerPosition[]>([]);
    const [pulsingKey, setPulsingKey] = useState<string | null>(null);

    const ranges = useMemo(() => {
      if (!insights || insights.status !== 'completed') {
        return [];
      }
      return findHighlightRanges(systemPrompt, insights);
    }, [systemPrompt, insights]);

    const segments = useMemo(() => {
      if (ranges.length === 0) {
        return null;
      }

      const parts: React.ReactNode[] = [];
      let cursor = 0;

      for (const range of ranges) {
        if (range.start > cursor) {
          parts.push(<span key={`text-${cursor}`}>{systemPrompt.slice(cursor, range.start)}</span>);
        }

        const isStrength = range.kind === 'strength';
        const highlightClass = isStrength ? styles.strengthHighlight : styles.weaknessHighlight;
        const markKey = `${range.kind}-${range.sourceIndex}`;

        parts.push(
          <Tooltip
            key={`hl-${range.start}`}
            content={
              <div className={styles.tooltipContent}>
                <div className={styles.tooltipHeader}>
                  <span
                    className={cx(
                      styles.tooltipIcon,
                      isStrength ? styles.tooltipIconStrength : styles.tooltipIconWeakness
                    )}
                  >
                    <Icon name={isStrength ? 'check' : 'exclamation-triangle'} size="xs" />
                  </span>
                  <strong className={styles.tooltipTitle}>{range.insight.title}</strong>
                </div>
                <p className={styles.tooltipExplanation}>{range.insight.explanation}</p>
              </div>
            }
            placement="top"
            interactive
          >
            <mark
              className={cx(
                highlightClass,
                styles.highlight,
                pulsingKey === markKey && (isStrength ? styles.pulseStrength : styles.pulseWeakness)
              )}
              data-insight-kind={range.kind}
              data-insight-index={range.sourceIndex}
              data-testid={`prompt-insight-${range.kind}`}
              onClick={() => onInsightClick?.(range.insight, range.kind, range.sourceIndex)}
              onAnimationEnd={() => {
                if (pulsingKey === markKey) {
                  setPulsingKey(null);
                }
              }}
            >
              {systemPrompt.slice(range.start, range.end)}
            </mark>
          </Tooltip>
        );

        cursor = range.end;
      }

      if (cursor < systemPrompt.length) {
        parts.push(<span key={`text-${cursor}`}>{systemPrompt.slice(cursor)}</span>);
      }

      return parts;
    }, [systemPrompt, ranges, styles, onInsightClick, pulsingKey]);

    useLayoutEffect(() => {
      const frame = requestAnimationFrame(() => {
        const pre = preRef.current;
        if (!pre || ranges.length === 0) {
          setMarkers([]);
          return;
        }

        const scrollHeight = pre.scrollHeight;
        if (scrollHeight <= 0) {
          setMarkers([]);
          return;
        }

        const nextMarkers: MarkerPosition[] = [];
        for (const range of ranges) {
          const mark = pre.querySelector<HTMLElement>(
            `mark[data-insight-kind="${range.kind}"][data-insight-index="${range.sourceIndex}"]`
          );
          if (!mark) {
            continue;
          }
          nextMarkers.push({
            topPercent: (mark.offsetTop / scrollHeight) * 100,
            kind: range.kind,
            insight: range.insight,
            sourceIndex: range.sourceIndex,
          });
        }
        setMarkers(nextMarkers);
      });

      return () => cancelAnimationFrame(frame);
    }, [ranges, segments]);

    const scrollToInsight = useCallback((kind: 'strength' | 'weakness', index: number) => {
      const pre = preRef.current;
      if (!pre) {
        return;
      }
      const mark = pre.querySelector<HTMLElement>(`mark[data-insight-kind="${kind}"][data-insight-index="${index}"]`);
      if (!mark) {
        return;
      }
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPulsingKey(`${kind}-${index}`);
    }, []);

    useImperativeHandle(ref, () => ({ scrollToInsight }), [scrollToInsight]);

    if (!segments) {
      return <pre className={className}>{systemPrompt.length > 0 ? systemPrompt : 'No system prompt recorded.'}</pre>;
    }

    return (
      <div className={styles.wrapper}>
        <pre ref={preRef} className={cx(className, styles.container)} data-testid="highlighted-system-prompt">
          {segments}
        </pre>
        {markers.length > 0 && (
          <div className={styles.markerTrack} aria-hidden>
            {markers.map((m) => (
              <button
                key={`${m.kind}-${m.sourceIndex}`}
                type="button"
                className={cx(styles.marker, m.kind === 'strength' ? styles.markerStrength : styles.markerWeakness)}
                style={{ top: `${m.topPercent}%` }}
                onClick={() => {
                  onInsightClick?.(m.insight, m.kind, m.sourceIndex);
                  scrollToInsight(m.kind, m.sourceIndex);
                }}
                aria-label={`${m.kind}: ${m.insight.title}`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

const pulseStrengthKeyframes = keyframes({
  '0%': { boxShadow: '0 0 0 0px rgba(115, 191, 105, 0.55)' },
  '100%': { boxShadow: '0 0 0 8px rgba(115, 191, 105, 0)' },
});

const pulseWeaknessKeyframes = keyframes({
  '0%': { boxShadow: '0 0 0 0px rgba(255, 152, 48, 0.55)' },
  '100%': { boxShadow: '0 0 0 8px rgba(255, 152, 48, 0)' },
});

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      position: 'relative',
      display: 'flex',
    }),
    container: css({
      position: 'relative',
      flex: 1,
      minWidth: 0,
    }),
    highlight: css({
      cursor: 'pointer',
      borderRadius: 3,
      padding: '1px 0',
      transition: 'filter 0.15s ease, box-shadow 0.15s ease',
      '&:hover': {
        filter: 'brightness(1.15)',
        boxShadow: `0 0 0 1px ${theme.colors.border.medium}`,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.border}`,
        outlineOffset: 1,
      },
    }),
    strengthHighlight: css({
      backgroundColor: `${theme.colors.success.main}14`,
      borderBottom: `2px solid ${theme.colors.success.border}`,
      color: theme.colors.text.primary,
    }),
    weaknessHighlight: css({
      backgroundColor: `${theme.colors.warning.main}14`,
      borderBottom: `2px solid ${theme.colors.warning.border}`,
      color: theme.colors.text.primary,
    }),
    pulseStrength: css({
      animation: `${pulseStrengthKeyframes} 0.6s ease-out`,
    }),
    pulseWeakness: css({
      animation: `${pulseWeaknessKeyframes} 0.6s ease-out`,
    }),
    markerTrack: css({
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: 14,
      pointerEvents: 'none',
      zIndex: 1,
    }),
    marker: css({
      all: 'unset',
      position: 'absolute',
      right: 3,
      width: 8,
      height: 8,
      borderRadius: '50%',
      cursor: 'pointer',
      pointerEvents: 'auto',
      transform: 'translateY(-50%)',
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      '&:hover': {
        transform: 'translateY(-50%) scale(1.4)',
        boxShadow: theme.shadows.z1,
      },
    }),
    markerStrength: css({
      backgroundColor: theme.colors.success.main,
    }),
    markerWeakness: css({
      backgroundColor: theme.colors.warning.main,
    }),
    tooltipContent: css({
      maxWidth: 340,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    tooltipHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    tooltipIcon: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      borderRadius: '50%',
      flexShrink: 0,
    }),
    tooltipIconStrength: css({
      color: theme.colors.success.text,
      backgroundColor: `${theme.colors.success.main}33`,
    }),
    tooltipIconWeakness: css({
      color: theme.colors.warning.text,
      backgroundColor: `${theme.colors.warning.main}33`,
    }),
    tooltipTitle: css({
      display: 'block',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.maxContrast,
    }),
    tooltipExplanation: css({
      margin: 0,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.45,
    }),
  };
}

export { findHighlightRanges };
export type { HighlightRange };
