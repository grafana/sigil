import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { getValueFormat, formattedValueToString, type GrafanaTheme2 } from '@grafana/data';
import { Spinner, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import type { ModelResolvePair, PrometheusQueryResponse } from '../../dashboard/types';

// --- formatStatValue ---

export function formatStatValue(value: number, unit?: string): string {
  const fmt = getValueFormat(unit ?? 'short');
  return formattedValueToString(fmt(value));
}

// --- StatItem ---

type StatItemStyles = ReturnType<typeof getStatItemStyles>;

type StatItemProps = {
  label: string;
  value: number;
  unit?: string;
  loading: boolean;
  styles?: StatItemStyles;
};

export function StatItem({ label, value, unit, loading, styles: stylesProp }: StatItemProps) {
  const defaultStyles = useStyles2(getStatItemStyles);
  const styles = stylesProp ?? defaultStyles;

  return (
    <div className={styles.topStat}>
      <span className={styles.topStatLabel}>{label}</span>
      <span className={styles.topStatValue}>{loading ? '–' : formatStatValue(value, unit)}</span>
    </div>
  );
}

export function getStatItemStyles(theme: GrafanaTheme2) {
  return {
    topStat: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    topStatLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
    }),
    topStatValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
    }),
  };
}

// --- extractResolvePairs ---

export function extractResolvePairs(response?: PrometheusQueryResponse | null): ModelResolvePair[] {
  if (!response || (response.data.resultType !== 'vector' && response.data.resultType !== 'matrix')) {
    return [];
  }
  const pairs: ModelResolvePair[] = [];
  for (const result of response.data.result) {
    const provider = result.metric.gen_ai_provider_name ?? '';
    const model = result.metric.gen_ai_request_model ?? '';
    if (provider && model) {
      pairs.push({ provider, model });
    }
  }
  return pairs;
}

type ProviderMappingBadgeRowProps = {
  mapped: Array<{
    provider: string;
    model: string;
    sourceModelID: string;
  }>;
  maxItems?: number;
};

export function ProviderMappingBadgeRow({ mapped, maxItems = 6 }: ProviderMappingBadgeRowProps) {
  const styles = useStyles2(getProviderMappingBadgeRowStyles);
  if (mapped.length === 0) {
    return null;
  }

  const visibleMappings = mapped.slice(0, maxItems);
  return (
    <div className={styles.mappingRow}>
      <span className={styles.mappingLabel}>Resolved via provider mapping:</span>
      <div className={styles.mappingList}>
        {visibleMappings.map((entry) => (
          <span key={`${entry.provider}::${entry.model}::${entry.sourceModelID}`} className={styles.mappingBadge}>
            {entry.provider}:{entry.model} {'->'} {entry.sourceModelID}
          </span>
        ))}
        {mapped.length > maxItems && <span className={styles.mappingBadge}>+{mapped.length - maxItems} more</span>}
      </div>
    </div>
  );
}

function getProviderMappingBadgeRowStyles(theme: GrafanaTheme2) {
  return {
    mappingRow: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      marginTop: theme.spacing(0.5),
    }),
    mappingLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    mappingList: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(0.75),
    }),
    mappingBadge: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: 999,
      padding: theme.spacing(0.25, 1),
      whiteSpace: 'normal',
      wordBreak: 'break-all',
    }),
  };
}

// --- BreakdownStatPanel (theme-derived palette, supports stacked bars, aggregation) ---

export function stringHash(str: string): number {
  let hash = 5381;
  let i = str.length;
  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  return hash >>> 0;
}

export function getBarPalette(theme: GrafanaTheme2): string[] {
  const bg = theme.colors.background.primary;
  const threshold = theme.colors.contrastThreshold;
  return theme.visualization.palette
    .filter((name) => contrastRatio(theme.visualization.getColorByName(name), bg) >= threshold)
    .map((name) => theme.visualization.getColorByName(name));
}

function relativeLuminance(hex: string): number {
  const raw = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fg: string, bg: string): number {
  const lumA = relativeLuminance(fg);
  const lumB = relativeLuminance(bg);
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

export type BreakdownStatPanelProps = {
  title: string;
  data: PrometheusQueryResponse | null | undefined;
  loading: boolean;
  error?: string;
  breakdownLabel?: string;
  height: number;
  unit?: string;
  aggregation?: 'sum' | 'avg';
  /** When set, used as the panel aggregate instead of computing from items. Use for rate/percent panels where the correct aggregate is the global rate (e.g. error rate by model should show total errors/total requests, not avg of per-model rates). */
  aggregateOverride?: number;
  segmentLabel?: string;
  segmentNames?: string[];
};

export function BreakdownStatPanel({
  title,
  data,
  loading,
  error,
  breakdownLabel,
  height,
  unit = 'short',
  aggregation = 'sum',
  aggregateOverride,
  segmentLabel,
  segmentNames,
}: BreakdownStatPanelProps) {
  const styles = useStyles2(getBreakdownStatPanelStyles);
  const theme = useTheme2();

  const resolvedPalette = useMemo(() => getBarPalette(theme), [theme]);

  const isStacked = Boolean(segmentLabel && segmentNames && segmentNames.length > 0);

  const items = useMemo(() => {
    if (isStacked || !data || data.data.resultType !== 'vector') {
      return [];
    }
    const results = data.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
    return results
      .map((r) => {
        const name =
          (breakdownLabel ? r.metric[breakdownLabel] : '') ||
          Object.values(r.metric).filter(Boolean).join(' / ') ||
          'unknown';
        const color = resolvedPalette[stringHash(name) % resolvedPalette.length];
        return { name, value: parseFloat(r.value[1]), color };
      })
      .filter((r) => isFinite(r.value))
      .sort((a, b) => b.value - a.value);
  }, [data, breakdownLabel, isStacked, resolvedPalette]);

  type StackedItem = {
    name: string;
    total: number;
    color: string;
    segments: Array<{ segName: string; value: number; color: string }>;
  };

  const stackedItems = useMemo((): StackedItem[] => {
    if (!isStacked || !data || data.data.resultType !== 'vector' || !segmentLabel || !segmentNames) {
      return [];
    }
    const results = data.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
    const grouped = new Map<string, Map<string, number>>();
    for (const r of results) {
      const breakdownName = (breakdownLabel ? r.metric[breakdownLabel] : '') || 'unknown';
      const seg = r.metric[segmentLabel] || 'unknown';
      const val = parseFloat(r.value[1]);
      if (!isFinite(val)) {
        continue;
      }
      if (!grouped.has(breakdownName)) {
        grouped.set(breakdownName, new Map());
      }
      grouped.get(breakdownName)!.set(seg, (grouped.get(breakdownName)!.get(seg) ?? 0) + val);
    }

    const segColors = new Map<string, string>();
    for (const seg of segmentNames) {
      segColors.set(seg, resolvedPalette[stringHash(seg) % resolvedPalette.length]);
    }

    return Array.from(grouped.entries())
      .map(([name, segs]) => {
        const total = Array.from(segs.values()).reduce((s, v) => s + v, 0);
        const segments = segmentNames.map((sn) => ({
          segName: sn,
          value: segs.get(sn) ?? 0,
          color: segColors.get(sn) ?? resolvedPalette[0],
        }));
        return { name, total, color: resolvedPalette[stringHash(name) % resolvedPalette.length], segments };
      })
      .sort((a, b) => b.total - a.total);
  }, [isStacked, data, breakdownLabel, segmentLabel, segmentNames, resolvedPalette]);

  const aggregate = useMemo(() => {
    if (aggregateOverride !== undefined && isFinite(aggregateOverride)) {
      return aggregateOverride;
    }
    const src = isStacked ? stackedItems.map((i) => i.total) : items.map((i) => i.value);
    if (src.length === 0) {
      return 0;
    }
    const total = src.reduce((s, v) => s + v, 0);
    return aggregation === 'avg' ? total / src.length : total;
  }, [items, stackedItems, isStacked, aggregation, aggregateOverride]);

  const formatVal = (v: number) => formattedValueToString(getValueFormat(unit)(v));

  if (loading) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter} style={{ opacity: 0.6 }}>
          {error}
        </div>
      </div>
    );
  }

  if (isStacked && stackedItems.length > 0) {
    const maxTotal = stackedItems[0].total;
    const segColors = segmentNames!.map((sn) => ({
      name: sn,
      color: resolvedPalette[stringHash(sn) % resolvedPalette.length],
    }));
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
          <div className={styles.bspValueRow}>
            <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
          </div>
          <div className={styles.bspSegmentLegend}>
            {segColors.map((sc) => (
              <span key={sc.name} className={styles.bspSegmentLegendItem}>
                <span className={styles.bspBarDot} style={{ background: sc.color }} />
                {sc.name}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.bspList}>
          {stackedItems.map((item) => {
            const barWidth = maxTotal > 0 ? (item.total / maxTotal) * 100 : 0;
            return (
              <div key={item.name} className={styles.bspBarRow}>
                <div className={styles.bspBarMeta}>
                  <span className={styles.bspBarName}>{item.name}</span>
                  <span className={styles.bspBarValue}>{formatVal(item.total)}</span>
                </div>
                <div className={styles.bspBarTrack}>
                  <div
                    style={{
                      display: 'flex',
                      width: `${barWidth}%`,
                      height: '100%',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    {item.segments.map((seg) => {
                      const segPct = item.total > 0 ? (seg.value / item.total) * 100 : 0;
                      if (segPct === 0) {
                        return null;
                      }
                      return (
                        <Tooltip key={seg.segName} content={`${seg.segName}: ${formatVal(seg.value)}`}>
                          <div style={{ width: `${segPct}%`, height: '100%', background: seg.color, minWidth: 2 }} />
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter}>
          <span className={styles.bspBigValue}>{formatVal(0)}</span>
        </div>
      </div>
    );
  }

  if (items.length === 1) {
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
        </div>
        <div className={styles.bspCenter}>
          <div style={{ textAlign: 'center' }}>
            <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
            {items[0].name !== 'unknown' && <div className={styles.bspSingleLabel}>{items[0].name}</div>}
          </div>
        </div>
      </div>
    );
  }

  const maxValue = items[0].value;
  return (
    <div className={styles.bspPanel} style={{ height }}>
      <div className={styles.bspHeader}>
        <span className={styles.bspTitle}>{title}</span>
        <div className={styles.bspValueRow}>
          <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
        </div>
      </div>
      <div className={styles.bspList}>
        {items.map((item) => {
          const barWidth = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
          return (
            <div key={item.name} className={styles.bspBarRow}>
              <div className={styles.bspBarMeta}>
                <span className={styles.bspBarDot} style={{ background: item.color }} />
                <span className={styles.bspBarName}>{item.name}</span>
                <span className={styles.bspBarValue}>{formatVal(item.value)}</span>
              </div>
              <div className={styles.bspBarTrack}>
                <div className={styles.bspBarFill} style={{ width: `${barWidth}%`, background: item.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function getBreakdownStatPanelStyles(theme: GrafanaTheme2) {
  return {
    bspPanel: css({
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    bspHeader: css({
      padding: theme.spacing(1.5, 2),
      flexShrink: 0,
    }),
    bspTitle: css({
      display: 'block',
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing(0.25),
    }),
    bspValueRow: css({
      display: 'flex',
      alignItems: 'baseline',
      gap: theme.spacing(1),
    }),
    bspCenter: css({
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    bspBigValue: css({
      fontSize: 32,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      letterSpacing: '-0.02em',
      lineHeight: 1,
    }),
    bspList: css({
      flex: 1,
      overflowY: 'auto',
      padding: theme.spacing(0, 1, 1, 1),
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.25),
    }),
    bspBarRow: css({
      padding: theme.spacing(0, 1),
    }),
    bspBarMeta: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      marginBottom: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1,
    }),
    bspBarDot: css({
      width: 8,
      height: 8,
      borderRadius: '50%',
      flexShrink: 0,
    }),
    bspBarName: css({
      flex: 1,
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    bspBarValue: css({
      color: theme.colors.text.secondary,
      fontVariantNumeric: 'tabular-nums',
      flexShrink: 0,
    }),
    bspBarTrack: css({
      height: 6,
      borderRadius: 3,
      background: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    bspBarFill: css({
      height: '100%',
      borderRadius: 3,
      transition: 'width 0.3s ease',
    }),
    bspSingleLabel: css({
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    bspSegmentLegend: css({
      display: 'flex',
      gap: theme.spacing(1.5),
      marginTop: theme.spacing(0.5),
    }),
    bspSegmentLegendItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
  };
}

export function formatRelativeTime(dateStr: string): string {
  const ts = Date.parse(dateStr);
  if (!Number.isFinite(ts)) {
    return '-';
  }
  const diffMs = Date.now() - ts;
  if (diffMs < 0) {
    return 'just now';
  }
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
