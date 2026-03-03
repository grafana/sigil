import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import {
  ThresholdsMode,
  getValueFormat,
  formattedValueToString,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import { Spinner, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type ModelResolvePair,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import {
  calculateTotalCost,
  calculateTotalCostByGroup,
  calculateCostTimeSeries,
} from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalTokensQuery,
  totalTokensOverTimeQuery,
  tokensByTypeQuery,
  tokensByTypeOverTimeQuery,
  tokensByModelAndTypeQuery,
  tokensByModelAndTypeOverTimeQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';

export type DashboardConsumptionGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
};

const CHART_HEIGHT = 320;

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardConsumptionGrid({
  dataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
}: DashboardConsumptionGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  // --- Top stats (always aggregate, no breakdown) ---
  const tokensTotalStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );
  const inputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['input']),
    from,
    to,
    'instant'
  );
  const outputTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['output']),
    from,
    to,
    'instant'
  );
  const cacheReadTokensStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_read']),
    from,
    to,
    'instant'
  );

  // --- Cost calculation ---
  const costTokensData = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );
  const costOverTimeData = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  const resolvePairs = useMemo(() => {
    const pairs: ModelResolvePair[] = [];
    if (costTokensData.data) {
      pairs.push(...extractResolvePairs(costTokensData.data));
    }
    if (costOverTimeData.data) {
      pairs.push(...extractResolvePairs(costOverTimeData.data));
    }
    return pairs;
  }, [costTokensData.data, costOverTimeData.data]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  const totalCost = useMemo(() => {
    return calculateTotalCost(costTokensData.data ?? undefined, resolvedPricing.pricingMap);
  }, [costTokensData.data, resolvedPricing.pricingMap]);

  // --- Tokens by type (instant breakdown for pie) ---
  const tokensByTypeStat = usePrometheusQuery(
    dataSource,
    tokensByTypeQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );

  // --- Tokens by type over time ---
  const tokensByTypeTimeseries = usePrometheusQuery(
    dataSource,
    tokensByTypeOverTimeQuery(filters, interval, undefined, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Total tokens over time (with breakdown) ---
  const tokensTotalTimeseries = usePrometheusQuery(
    dataSource,
    totalTokensOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Tokens by breakdown dimension ---
  const tokensByBreakdown = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  // --- Cost by breakdown ---
  const costGroupByLabel = breakdownPromLabel;
  const costByBreakdownData = useMemo<PrometheusQueryResponse | null>(() => {
    if (!costTokensData.data) {
      return null;
    }
    if (!costGroupByLabel) {
      return {
        status: 'success',
        data: {
          resultType: 'vector' as const,
          result: [{ metric: {}, value: [0, String(totalCost.totalCost)] as [number, string] }],
        },
      };
    }
    const groups = calculateTotalCostByGroup(costTokensData.data ?? undefined, resolvedPricing.pricingMap, costGroupByLabel);
    return {
      status: 'success',
      data: {
        resultType: 'vector' as const,
        result: groups.map((g) => ({
          metric: { [costGroupByLabel]: g.label },
          value: [0, String(g.cost)] as [number, string],
        })),
      },
    };
  }, [costGroupByLabel, costTokensData.data, resolvedPricing.pricingMap, totalCost.totalCost]);

  const costTimeSeries = useMemo(() => {
    if (!costOverTimeData.data) {
      return [];
    }
    return calculateCostTimeSeries(costOverTimeData.data ?? undefined, resolvedPricing.pricingMap, costGroupByLabel);
  }, [costOverTimeData.data, resolvedPricing.pricingMap, costGroupByLabel]);

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const consumptionOptions = {
    legend: { displayMode: 'table', placement: 'right', calcs: ['mean'], maxWidth: 280 },
    tooltip: tooltipOptions,
  };

  const totalTokensValue = tokensTotalStat.data ? vectorToStatValue(tokensTotalStat.data) : 0;
  const inputTokensValue = inputTokensStat.data ? vectorToStatValue(inputTokensStat.data) : 0;
  const outputTokensValue = outputTokensStat.data ? vectorToStatValue(outputTokensStat.data) : 0;
  const cacheReadValue = cacheReadTokensStat.data ? vectorToStatValue(cacheReadTokensStat.data) : 0;
  const cacheHitRate = inputTokensValue + cacheReadValue > 0
    ? (cacheReadValue / (inputTokensValue + cacheReadValue)) * 100
    : 0;

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <div className={styles.statsRow}>
        <StatItem label="Total Tokens" value={totalTokensValue} unit="short" loading={tokensTotalStat.loading} styles={styles} />
        <StatItem label="Input Tokens" value={inputTokensValue} unit="short" loading={inputTokensStat.loading} styles={styles} />
        <StatItem label="Output Tokens" value={outputTokensValue} unit="short" loading={outputTokensStat.loading} styles={styles} />
        <StatItem label="Cache Read" value={cacheReadValue} unit="short" loading={cacheReadTokensStat.loading} styles={styles} />
        <StatItem label="Cache Hit Rate" value={cacheHitRate} unit="percent" loading={cacheReadTokensStat.loading || inputTokensStat.loading} styles={styles} />
        <StatItem label="Estimated Cost" value={totalCost.totalCost} unit="currencyUSD" loading={costTokensData.loading || resolvedPricing.loading} styles={styles} />
      </div>

      <div className={styles.grid}>
        {/* Row 1: Tokens by type over time + Tokens by type breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Tokens by type over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={tokensByTypeTimeseries.loading}
            error={tokensByTypeTimeseries.error}
            data={tokensByTypeTimeseries.data ? matrixToDataFrames(tokensByTypeTimeseries.data) : []}
            options={consumptionOptions}
            fieldConfig={{
              defaults: {
                unit: 'short',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title="Tokens by type"
            data={tokensByTypeStat.data}
            loading={tokensByTypeStat.loading}
            error={tokensByTypeStat.error}
            breakdownLabel="gen_ai_token_type"
            height={CHART_HEIGHT}
          />
        </div>

        {/* Row 2: Total tokens over time (by breakdown) + Tokens by breakdown */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Tokens over time by ${breakdownBy}` : 'Total tokens over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={tokensTotalTimeseries.loading}
            error={tokensTotalTimeseries.error}
            data={tokensTotalTimeseries.data ? matrixToDataFrames(tokensTotalTimeseries.data) : []}
            options={consumptionOptions}
            fieldConfig={{
              defaults: {
                unit: 'short',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          {hasBreakdown ? (
            <BreakdownStatPanel
              title={`Tokens by ${breakdownBy}`}
              data={tokensByBreakdown.data}
              loading={tokensByBreakdown.loading}
              error={tokensByBreakdown.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
            />
          ) : (
            <BreakdownStatPanel
              title="Total Tokens"
              data={tokensTotalStat.data}
              loading={tokensTotalStat.loading}
              error={tokensTotalStat.error}
              height={CHART_HEIGHT}
            />
          )}
        </div>

        {/* Row 4: Estimated cost over time + Estimated Cost stat */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Cost over time by ${breakdownBy}` : 'Estimated cost over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={costOverTimeData.loading || resolvedPricing.loading}
            error={costOverTimeData.error}
            data={costTimeSeries}
            options={consumptionOptions}
            fieldConfig={{
              defaults: {
                unit: 'currencyUSD',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title={hasBreakdown ? `Cost by ${breakdownBy}` : 'Estimated Cost'}
            data={costByBreakdownData}
            loading={costTokensData.loading || resolvedPricing.loading}
            error={costTokensData.error}
            breakdownLabel={costGroupByLabel}
            height={CHART_HEIGHT}
            unit="currencyUSD"
          />
        </div>
      </div>
    </div>
  );
}

function formatStatValue(value: number, unit?: string): string {
  const fmt = getValueFormat(unit ?? 'short');
  return formattedValueToString(fmt(value));
}

type StatItemProps = {
  label: string;
  value: number;
  unit?: string;
  loading: boolean;
  styles: ReturnType<typeof getStyles>;
};

function StatItem({ label, value, unit, loading, styles }: StatItemProps) {
  return (
    <div className={styles.topStat}>
      <span className={styles.topStatLabel}>{label}</span>
      <span className={styles.topStatValue}>{loading ? '–' : formatStatValue(value, unit)}</span>
    </div>
  );
}

function extractResolvePairs(response?: PrometheusQueryResponse): ModelResolvePair[] {
  if (!response) {
    return [];
  }
  if (response.data.resultType !== 'vector' && response.data.resultType !== 'matrix') {
    return [];
  }
  const pairs: ModelResolvePair[] = [];
  for (const result of response.data.result) {
    const provider = result.metric.gen_ai_provider_name ?? '';
    const model = result.metric.gen_ai_request_model ?? '';
    if (!provider || !model) {
      continue;
    }
    pairs.push({ provider, model });
  }
  return pairs;
}

// --- BreakdownStatPanel ---

type BreakdownStatPanelProps = {
  title: string;
  data: PrometheusQueryResponse | null | undefined;
  loading: boolean;
  error?: string;
  breakdownLabel?: string;
  height: number;
  unit?: string;
  aggregation?: 'sum' | 'avg';
  segmentLabel?: string;
  segmentNames?: string[];
};

function BreakdownStatPanel({
  title,
  data,
  loading,
  error,
  breakdownLabel,
  height,
  unit = 'short',
  aggregation = 'sum',
  segmentLabel,
  segmentNames,
}: BreakdownStatPanelProps) {
  const styles = useStyles2(getStyles);
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
        return { name, value: parseFloat(r.value[1]) };
      })
      .filter((r) => isFinite(r.value))
      .sort((a, b) => b.value - a.value);
  }, [data, breakdownLabel, isStacked]);

  type StackedItem = {
    name: string;
    total: number;
    segments: Array<{ segName: string; value: number }>;
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
    return Array.from(grouped.entries())
      .map(([name, segs]) => {
        const total = Array.from(segs.values()).reduce((s, v) => s + v, 0);
        const segments = segmentNames.map((sn) => ({
          segName: sn,
          value: segs.get(sn) ?? 0,
        }));
        return { name, total, segments };
      })
      .sort((a, b) => b.total - a.total);
  }, [isStacked, data, breakdownLabel, segmentLabel, segmentNames]);

  const aggregate = useMemo(() => {
    const src = isStacked ? stackedItems.map((i) => i.total) : items.map((i) => i.value);
    if (src.length === 0) {
      return 0;
    }
    const total = src.reduce((s, v) => s + v, 0);
    return aggregation === 'avg' ? total / src.length : total;
  }, [items, stackedItems, isStacked, aggregation]);

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
    const segColorMap = new Map<string, string>([
      ['input', '#7eb26d'],
      ['output', '#eab839'],
      ['cache_read', '#6ed0e0'],
      ['cache_write', '#ef843c'],
    ]);
    return (
      <div className={styles.bspPanel} style={{ height }}>
        <div className={styles.bspHeader}>
          <span className={styles.bspTitle}>{title}</span>
          <div className={styles.bspValueRow}>
            <span className={styles.bspBigValue}>{formatVal(aggregate)}</span>
          </div>
          <div className={styles.bspSegmentLegend}>
            {segmentNames!.map((sn) => (
              <span key={sn} className={styles.bspSegmentLegendItem}>
                <span className={styles.bspBarDot} style={{ background: segColorMap.get(sn) ?? '#888' }} />
                {sn}
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
                  <div style={{ display: 'flex', width: `${barWidth}%`, height: '100%', borderRadius: 3, overflow: 'hidden' }}>
                    {item.segments.map((seg) => {
                      const segPct = item.total > 0 ? (seg.value / item.total) * 100 : 0;
                      if (segPct === 0) {
                        return null;
                      }
                      return (
                        <div
                          key={seg.segName}
                          style={{ width: `${segPct}%`, height: '100%', background: segColorMap.get(seg.segName) ?? '#888', minWidth: 2 }}
                          title={`${seg.segName}: ${formatVal(seg.value)}`}
                        />
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
            <div className={styles.bspSingleLabel}>{items[0].name}</div>
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
                <span className={styles.bspBarName}>{item.name}</span>
                <span className={styles.bspBarValue}>{formatVal(item.value)}</span>
              </div>
              <div className={styles.bspBarTrack}>
                <div className={styles.bspBarFill} style={{ width: `${barWidth}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    gridWrapper: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    grid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
    }),
    statsRow: css({
      display: 'flex',
      gap: theme.spacing(4),
      padding: theme.spacing(1.5, 0),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      flexWrap: 'wrap',
    }),
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
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
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
      background: theme.colors.primary.main,
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
