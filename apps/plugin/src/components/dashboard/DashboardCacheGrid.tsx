import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { ThresholdsMode, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type DashboardFilters,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import {
  formatStatValue,
  StatItem,
  extractResolvePairs,
  BreakdownStatPanel,
  getBreakdownStatPanelStyles,
  stringHash,
  getBarPalette,
} from './dashboardShared';
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

export function DashboardCacheGrid({ dataSource, filters, breakdownBy, from, to, timeRange }: DashboardCacheGridProps) {
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
    inputTokensValue + cacheReadValue > 0 ? (cacheReadValue / (inputTokensValue + cacheReadValue)) * 100 : 0;

  const savings = useMemo(() => {
    return calculateCacheSavings(cacheByModelData.data ?? undefined, resolvedPricing.pricingMap);
  }, [cacheByModelData.data, resolvedPricing.pricingMap]);

  const cacheHitRateByModelData = useMemo(
    () => buildCacheHitRateByModelResponse(cacheByModelData.data),
    [cacheByModelData.data]
  );

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
        <StatItem
          label="Cache Hit Rate"
          value={cacheHitRate}
          unit="percent"
          loading={cacheReadStat.loading || inputTokensStat.loading}
        />
        <StatItem label="Cache Read Tokens" value={cacheReadValue} unit="short" loading={cacheReadStat.loading} />
        <StatItem label="Cache Write Tokens" value={cacheWriteValue} unit="short" loading={cacheWriteStat.loading} />
        <StatItem label="Input Tokens" value={inputTokensValue} unit="short" loading={inputTokensStat.loading} />
        <StatItem
          label="Estimated Savings"
          value={savings.savings}
          unit="currencyUSD"
          loading={cacheByModelData.loading || resolvedPricing.loading}
        />
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
            data={cacheHitRateByModelData}
            loading={cacheByModelData.loading}
            error={cacheByModelData.error}
            breakdownLabel="model"
            height={CHART_HEIGHT}
            unit="percent"
            aggregation="avg"
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
        {savings.byModel.length > 0 && <SavingsTable items={savings.byModel} height={CHART_HEIGHT} />}
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
    const hitRate = entry.cacheRead + entry.input > 0 ? (entry.cacheRead / (entry.cacheRead + entry.input)) * 100 : 0;
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

type SavingsTableProps = {
  items: ModelSavings[];
  height: number;
};

function SavingsTable({ items, height }: SavingsTableProps) {
  const styles = useStyles2(getBreakdownStatPanelStyles);
  const theme = useTheme2();
  const palette = useMemo(() => getBarPalette(theme), [theme]);
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
          const color = palette[stringHash(`${item.provider}::${item.model}`) % palette.length];
          return (
            <div key={`${item.provider}::${item.model}`} className={styles.bspBarRow}>
              <div className={styles.bspBarMeta}>
                <span className={styles.bspBarName}>{item.model}</span>
                <span className={styles.bspBarValue}>
                  {formatStatValue(item.savings, 'currencyUSD')} · {formatStatValue(item.cacheHitRate, 'percent')} hit
                  rate
                </span>
              </div>
              <div className={styles.bspBarTrack}>
                <div className={styles.bspBarFill} style={{ width: `${barWidth}%`, background: color }} />
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
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
  };
}
