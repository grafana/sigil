import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { getValueFormat, formattedValueToString, LoadingState, type GrafanaTheme2 } from '@grafana/data';
import { PanelChrome, useStyles2 } from '@grafana/ui';
import type { PrometheusQueryResponse, PrometheusVectorResult } from '../../dashboard/types';

type TokenTypeConfig = { key: string; label: string; colorName: string };

const TOKEN_TYPES: readonly TokenTypeConfig[] = [
  { key: 'input', label: 'Input', colorName: 'blue' },
  { key: 'output', label: 'Output', colorName: 'green' },
  { key: 'cache_read', label: 'Cache Read', colorName: 'orange' },
  { key: 'cache_write', label: 'Cache Write', colorName: 'purple' },
];

export type TokenBreakdownPanelProps = {
  data: PrometheusQueryResponse | null;
  loading: boolean;
  error?: string;
  height: number;
  visibleTypes?: string[];
};

function formatTokens(value: number): string {
  const fmt = getValueFormat('short');
  return formattedValueToString(fmt(value));
}

function parseTokenBreakdown(data: PrometheusQueryResponse | null): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let total = 0;

  if (data?.data.resultType === 'vector') {
    const results = data.data.result as PrometheusVectorResult[];
    for (const r of results) {
      const tokenType = r.metric.gen_ai_token_type || 'unknown';
      const val = parseFloat(r.value[1]);
      if (!isNaN(val)) {
        byType[tokenType] = (byType[tokenType] || 0) + val;
        total += val;
      }
    }
  }

  return { total, byType };
}

function formatPercent(value: number, total: number): string {
  if (total === 0) {
    return '0%';
  }
  const pct = (value / total) * 100;
  if (pct < 0.1 && pct > 0) {
    return '<0.1%';
  }
  return `${pct.toFixed(1)}%`;
}

export function TokenBreakdownPanel({ data, loading, error, height, visibleTypes }: TokenBreakdownPanelProps) {
  const styles = useStyles2(getStyles);
  const accentColors = useStyles2(getAccentColors);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const breakdown = useMemo(() => parseTokenBreakdown(data), [data]);
  const displayTypes = useMemo(
    () => (visibleTypes ? TOKEN_TYPES.filter((t) => visibleTypes.includes(t.key)) : TOKEN_TYPES),
    [visibleTypes]
  );

  return (
    <div ref={containerRef} className={styles.container} style={{ height }}>
      {width > 0 && (
        <PanelChrome
          title="Token Breakdown"
          width={width}
          height={height}
          loadingState={loading ? LoadingState.Loading : undefined}
          statusMessage={error}
        >
          {() => (
            <div className={styles.content}>
              <div className={styles.totalSection}>
                <span className={styles.totalValue}>{formatTokens(breakdown.total)}</span>
                <span className={styles.totalLabel}>Total tokens</span>
              </div>
              <div className={styles.breakdownGrid}>
                {displayTypes.map(({ key, label, colorName }) => {
                  const value = breakdown.byType[key] ?? 0;
                  return (
                    <div key={key} className={`${styles.breakdownItem} ${accentColors[colorName]}`}>
                      <span className={styles.breakdownLabel}>{label}</span>
                      <span className={styles.breakdownValue}>{formatTokens(value)}</span>
                      <span className={`${styles.percentBadge} ${accentColors[`${colorName}Badge`]}`}>
                        {formatPercent(value, breakdown.total)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </PanelChrome>
      )}
    </div>
  );
}

function accentColor(theme: GrafanaTheme2, name: string): string {
  return theme.visualization.getColorByName(name);
}

function getAccentColors(theme: GrafanaTheme2): Record<string, string> {
  const colors: Record<string, { border: string; badge: string }> = {
    blue: { border: accentColor(theme, 'blue'), badge: accentColor(theme, 'blue') },
    green: { border: accentColor(theme, 'green'), badge: accentColor(theme, 'green') },
    orange: { border: accentColor(theme, 'orange'), badge: accentColor(theme, 'orange') },
    purple: { border: accentColor(theme, 'purple'), badge: accentColor(theme, 'purple') },
  };
  const result: Record<string, string> = {};
  for (const [name, c] of Object.entries(colors)) {
    result[name] = css({ borderLeftColor: c.border });
    result[`${name}Badge`] = css({ color: c.badge });
  }
  return result;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      width: '100%',
    }),
    content: css({
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: theme.spacing(1.5),
      gap: theme.spacing(1.5),
    }),
    totalSection: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto',
      padding: theme.spacing(1.5, 0, 0.5),
    }),
    totalValue: css({
      fontSize: 32,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.maxContrast,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
    }),
    totalLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      marginTop: theme.spacing(0.5),
      textTransform: 'uppercase' as const,
      letterSpacing: '0.04em',
      fontWeight: theme.typography.fontWeightMedium,
    }),
    breakdownGrid: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(1),
      flex: 1,
      minHeight: 0,
      alignContent: 'start',
    }),
    breakdownItem: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      padding: theme.spacing(1, 1.25),
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      borderLeft: `3px solid transparent`,
    }),
    breakdownLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    breakdownValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.maxContrast,
      lineHeight: 1.1,
      letterSpacing: '-0.01em',
    }),
    percentBadge: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1,
    }),
  };
}
