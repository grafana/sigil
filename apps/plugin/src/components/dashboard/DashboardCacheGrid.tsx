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
import { lookupPricing, pricingKey, type PricingMap } from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalTokensQuery,
  tokensByBreakdownAndTypeQuery,
  cacheHitRateOverTimeQuery,
  cacheTokensByTypeOverTimeQuery,
  cacheReadOverTimeQuery,
  cacheReadByBreakdownQuery,
  cacheTokensByModelQuery,
} from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';

export type DashboardCacheGridProps = {
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

export function DashboardCacheGrid({
  dataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
}: DashboardCacheGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';
  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  // --- Top stats ---
  const cacheReadStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_read']),
    from,
    to,
    'instant'
  );
  const cacheWriteStat = usePrometheusQuery(
    dataSource,
    totalTokensQuery(filters, rangeDuration, 'none', ['cache_write']),
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

  // Cache tokens by model for savings calculation
  const cacheByModelData = usePrometheusQuery(
    dataSource,
    cacheTokensByModelQuery(filters, rangeDuration),
    from,
    to,
    'instant'
  );

  const resolvePairs = useMemo(() => {
    if (!cacheByModelData.data) {
      return [];
    }
    return extractResolvePairs(cacheByModelData.data);
  }, [cacheByModelData.data]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  // --- Timeseries ---
  const cacheHitRateTimeseries = usePrometheusQuery(
    dataSource,
    cacheHitRateOverTimeQuery(filters, interval, hasBreakdown ? breakdownBy : 'none'),
    from,
    to,
    'range',
    step
  );

  const cacheTokensTimeseries = usePrometheusQuery(
    dataSource,
    cacheTokensByTypeOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );

  const cacheReadTimeseries = usePrometheusQuery(
    dataSource,
    hasBreakdown ? cacheReadOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Breakdown stat ---
  const cacheReadByBreakdown = usePrometheusQuery(
    dataSource,
    hasBreakdown ? cacheReadByBreakdownQuery(filters, rangeDuration, breakdownBy) : '',
    from,
    to,
    'instant'
  );

  // --- Cache tokens by breakdown + type (stacked: cache_read / cache_write) ---
  const cacheTokensByBreakdownAndType = usePrometheusQuery(
    dataSource,
    tokensByBreakdownAndTypeQuery(filters, rangeDuration, breakdownBy, ['cache_read', 'cache_write']),
    from,
    to,
    'instant'
  );

  // --- Derived values ---
  const cacheReadValue = cacheReadStat.data ? vectorToStatValue(cacheReadStat.data) : 0;
  const cacheWriteValue = cacheWriteStat.data ? vectorToStatValue(cacheWriteStat.data) : 0;
  const inputTokensValue = inputTokensStat.data ? vectorToStatValue(inputTokensStat.data) : 0;
  const cacheHitRate =
    inputTokensValue + cacheReadValue > 0
      ? (cacheReadValue / (inputTokensValue + cacheReadValue)) * 100
      : 0;

  const savings = useMemo(() => {
    return calculateCacheSavings(cacheByModelData.data ?? undefined, resolvedPricing.pricingMap);
  }, [cacheByModelData.data, resolvedPricing.pricingMap]);

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const tooltipOptions = { mode: 'multi', sort: 'desc' };
  const chartOptions = {
    legend: { displayMode: 'table', placement: 'right', calcs: ['mean'], maxWidth: 280 },
    tooltip: tooltipOptions,
  };
  const simpleOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: tooltipOptions,
  };

  return (
    <div className={styles.gridWrapper}>
      {/* Top stats */}
      <div className={styles.statsRow}>
        <StatItem label="Cache Hit Rate" value={cacheHitRate} unit="percent" loading={cacheReadStat.loading || inputTokensStat.loading} styles={styles} />
        <StatItem label="Cache Read Tokens" value={cacheReadValue} unit="short" loading={cacheReadStat.loading} styles={styles} />
        <StatItem label="Cache Write Tokens" value={cacheWriteValue} unit="short" loading={cacheWriteStat.loading} styles={styles} />
        <StatItem label="Input Tokens" value={inputTokensValue} unit="short" loading={inputTokensStat.loading} styles={styles} />
        <StatItem label="Estimated Savings" value={savings.savings} unit="currencyUSD" loading={cacheByModelData.loading || resolvedPricing.loading} styles={styles} />
      </div>

      <div className={styles.grid}>
        {/* Row 1: Cache hit rate over time + cache hit rate by model */}
        <div className={styles.panelRow}>
          <MetricPanel
            title={hasBreakdown ? `Cache hit rate by ${breakdownBy}` : 'Cache hit rate over time'}
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={cacheHitRateTimeseries.loading}
            error={cacheHitRateTimeseries.error}
            data={cacheHitRateTimeseries.data ? matrixToDataFrames(cacheHitRateTimeseries.data) : []}
            options={hasBreakdown ? chartOptions : simpleOptions}
            fieldConfig={{
              defaults: {
                unit: 'percent',
                min: 0,
                max: 100,
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <BreakdownStatPanel
            title="Cache hit rate by model"
            data={buildCacheHitRateByModelResponse(cacheByModelData.data)}
            loading={cacheByModelData.loading}
            error={cacheByModelData.error}
            breakdownLabel="model"
            height={CHART_HEIGHT}
            unit="percent"
          />
        </div>

        {/* Row 2: Cache read vs write over time + cache tokens by type */}
        <div className={styles.panelRow}>
          <MetricPanel
            title="Cache read vs write over time"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            loading={cacheTokensTimeseries.loading}
            error={cacheTokensTimeseries.error}
            data={cacheTokensTimeseries.data ? matrixToDataFrames(cacheTokensTimeseries.data) : []}
            options={simpleOptions}
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
            title={hasBreakdown ? `Cache tokens by ${breakdownBy}` : 'Cache tokens by type'}
            data={cacheTokensByBreakdownAndType.data}
            loading={cacheTokensByBreakdownAndType.loading}
            error={cacheTokensByBreakdownAndType.error}
            breakdownLabel={hasBreakdown ? breakdownPromLabel : 'gen_ai_token_type'}
            height={CHART_HEIGHT}
            segmentLabel={hasBreakdown ? 'gen_ai_token_type' : undefined}
            segmentNames={hasBreakdown ? ['cache_read', 'cache_write'] : undefined}
          />
        </div>

        {/* Row 3: Cache read by breakdown + breakdown bar chart */}
        {hasBreakdown && (
          <div className={styles.panelRow}>
            <MetricPanel
              title={`Cache read tokens by ${breakdownBy}`}
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={cacheReadTimeseries.loading}
              error={cacheReadTimeseries.error}
              data={cacheReadTimeseries.data ? matrixToDataFrames(cacheReadTimeseries.data) : []}
              options={chartOptions}
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
              title={`Cache read by ${breakdownBy}`}
              data={cacheReadByBreakdown.data}
              loading={cacheReadByBreakdown.loading}
              error={cacheReadByBreakdown.error}
              breakdownLabel={breakdownPromLabel}
              height={CHART_HEIGHT}
            />
          </div>
        )}

        {/* Savings breakdown by model */}
        {savings.byModel.length > 0 && (
          <SavingsTable items={savings.byModel} styles={styles} height={CHART_HEIGHT} />
        )}
      </div>
    </div>
  );
}

// --- Savings calculation ---

type ModelSavings = {
  model: string;
  provider: string;
  cacheReadTokens: number;
  inputTokens: number;
  cacheHitRate: number;
  savings: number;
};

type CacheSavingsResult = {
  savings: number;
  byModel: ModelSavings[];
};

function calculateCacheSavings(
  response: PrometheusQueryResponse | undefined,
  pricingMap: PricingMap
): CacheSavingsResult {
  if (!response || response.data.resultType !== 'vector') {
    return { savings: 0, byModel: [] };
  }
  const results = response.data.result as Array<{
    metric: Record<string, string>;
    value: [number, string];
  }>;

  // Group by model: collect cache_read and input token counts
  const modelTokens = new Map<string, { provider: string; model: string; cacheRead: number; input: number }>();
  for (const r of results) {
    const provider = r.metric.gen_ai_provider_name ?? '';
    const model = r.metric.gen_ai_request_model ?? '';
    const tokenType = r.metric.gen_ai_token_type ?? '';
    const count = parseFloat(r.value[1]);
    if (!isFinite(count) || !provider || !model) {
      continue;
    }
    const key = pricingKey(provider, model);
    if (!modelTokens.has(key)) {
      modelTokens.set(key, { provider, model, cacheRead: 0, input: 0 });
    }
    const entry = modelTokens.get(key)!;
    if (tokenType === 'cache_read') {
      entry.cacheRead += count;
    } else if (tokenType === 'input') {
      entry.input += count;
    }
  }

  let totalSavings = 0;
  const byModel: ModelSavings[] = [];

  for (const [, entry] of modelTokens) {
    if (entry.cacheRead <= 0) {
      continue;
    }
    const pricing = lookupPricing(pricingMap, entry.model, entry.provider);
    if (!pricing) {
      continue;
    }
    const fullInputCost = entry.cacheRead * (pricing.prompt_usd_per_token ?? 0);
    const cachedCost = entry.cacheRead * (pricing.input_cache_read_usd_per_token ?? 0);
    const saved = fullInputCost - cachedCost;
    if (saved <= 0) {
      continue;
    }
    totalSavings += saved;
    const hitRate =
      entry.cacheRead + entry.input > 0
        ? (entry.cacheRead / (entry.cacheRead + entry.input)) * 100
        : 0;
    byModel.push({
      model: entry.model,
      provider: entry.provider,
      cacheReadTokens: entry.cacheRead,
      inputTokens: entry.input,
      cacheHitRate: hitRate,
      savings: saved,
    });
  }

  byModel.sort((a, b) => b.savings - a.savings);
  return { savings: totalSavings, byModel };
}

function buildCacheHitRateByModelResponse(
  response: PrometheusQueryResponse | null | undefined
): PrometheusQueryResponse | null {
  if (!response || response.data.resultType !== 'vector') {
    return null;
  }
  const results = response.data.result as Array<{
    metric: Record<string, string>;
    value: [number, string];
  }>;

  const modelTokens = new Map<string, { model: string; cacheRead: number; input: number }>();
  for (const r of results) {
    const model = r.metric.gen_ai_request_model ?? '';
    const tokenType = r.metric.gen_ai_token_type ?? '';
    const count = parseFloat(r.value[1]);
    if (!isFinite(count) || !model) {
      continue;
    }
    if (!modelTokens.has(model)) {
      modelTokens.set(model, { model, cacheRead: 0, input: 0 });
    }
    const entry = modelTokens.get(model)!;
    if (tokenType === 'cache_read') {
      entry.cacheRead += count;
    } else if (tokenType === 'input') {
      entry.input += count;
    }
  }

  const vectorResults: Array<{ metric: Record<string, string>; value: [number, string] }> = [];
  for (const [, entry] of modelTokens) {
    const total = entry.cacheRead + entry.input;
    if (total <= 0) {
      continue;
    }
    const hitRate = (entry.cacheRead / total) * 100;
    vectorResults.push({
      metric: { model: entry.model },
      value: [0, String(hitRate)],
    });
  }

  return {
    status: 'success',
    data: { resultType: 'vector', result: vectorResults },
  };
}

function extractResolvePairs(response?: PrometheusQueryResponse): ModelResolvePair[] {
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

// --- Sub-components ---

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

type SavingsTableProps = {
  items: ModelSavings[];
  styles: ReturnType<typeof getStyles>;
  height: number;
};

function SavingsTable({ items, styles, height }: SavingsTableProps) {
  const totalSavings = items.reduce((s, i) => s + i.savings, 0);
  return (
    <div className={styles.bspPanel} style={{ height }}>
      <div className={styles.bspHeader}>
        <span className={styles.bspTitle}>Cache savings by model</span>
        <div className={styles.bspValueRow}>
          <span className={styles.bspBigValue}>{formatStatValue(totalSavings, 'currencyUSD')}</span>
        </div>
      </div>
      <div className={styles.bspList}>
        {items.map((item) => {
          const barWidth = totalSavings > 0 ? (item.savings / items[0].savings) * 100 : 0;
          return (
            <div key={`${item.provider}::${item.model}`} className={styles.bspBarRow}>
              <div className={styles.bspBarMeta}>
                <span className={styles.bspBarName}>{item.model}</span>
                <span className={styles.bspBarValue}>
                  {formatStatValue(item.savings, 'currencyUSD')} · {formatStatValue(item.cacheHitRate, 'percent')} hit rate
                </span>
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

type BreakdownStatPanelProps = {
  title: string;
  data: PrometheusQueryResponse | null | undefined;
  loading: boolean;
  error?: string;
  breakdownLabel?: string;
  height: number;
  unit?: string;
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
  segmentLabel,
  segmentNames,
}: BreakdownStatPanelProps) {
  const styles = useStyles2(getStyles);
  const isStacked = Boolean(segmentLabel && segmentNames && segmentNames.length > 0);

  const items = useMemo(() => {
    if (isStacked || !data || data.data.resultType !== 'vector') {
      return [];
    }
    const results = data.data.result as Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
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
        const segments = segmentNames.map((sn) => ({ segName: sn, value: segs.get(sn) ?? 0 }));
        return { name, total, segments };
      })
      .sort((a, b) => b.total - a.total);
  }, [isStacked, data, breakdownLabel, segmentLabel, segmentNames]);

  const aggregate = useMemo(() => {
    const src = isStacked ? stackedItems.map((i) => i.total) : items.map((i) => i.value);
    if (src.length === 0) {
      return 0;
    }
    return src.reduce((s, v) => s + v, 0);
  }, [items, stackedItems, isStacked]);

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
      ['cache_read', '#6ed0e0'],
      ['cache_write', '#ef843c'],
      ['input', '#7eb26d'],
      ['output', '#eab839'],
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
    bspBarDot: css({
      width: 8,
      height: 8,
      borderRadius: '50%',
      flexShrink: 0,
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
