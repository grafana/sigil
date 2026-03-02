import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { FieldType, MutableDataFrame, ThresholdsMode, textUtil, type GrafanaTheme2, type IconName, type TimeRange } from '@grafana/data';
import { Icon, IconButton, Select, Spinner, useStyles2 } from '@grafana/ui';
import { useInlineAssistant } from '@grafana/assistant';
import type { DashboardDataSource } from '../../dashboard/api';
import {
  type BreakdownDimension,
  type CostMode,
  type DashboardFilters,
  type LatencyPercentile,
  type ModelResolvePair,
  type PrometheusQueryResponse,
  breakdownToPromLabel,
} from '../../dashboard/types';
import { calculateTotalCost, calculateTotalCostByGroup, calculateCostTimeSeries } from '../../dashboard/cost';
import {
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalOpsQuery,
  errorRateQuery,
  latencyStatQuery,
  tokensByModelAndTypeQuery,
  totalTokensQuery,
  totalTokensOverTimeQuery,
  requestsSuccessOverTimeQuery,
  requestsErrorOverTimeQuery,
  requestsOverTimeQuery,
  errorsByCodeOverTimeQuery,
  latencyOverTimeQuery,
  tokensByModelAndTypeOverTimeQuery,
} from '../../dashboard/queries';
import {
  matrixToDataFrames,
  vectorToStatValue,
  vectorToPieDataFrame,
  statValueToDataFrame,
} from '../../dashboard/transforms';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { useResolvedModelPricing } from './useResolvedModelPricing';

export type DashboardGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  latencyPercentile: LatencyPercentile;
  costMode: CostMode;
  from: number;
  to: number;
  timeRange: TimeRange;
  onLatencyPercentileChange: (p: LatencyPercentile) => void;
  onCostModeChange: (m: CostMode) => void;
};

const CHART_HEIGHT = 320;

const costModeOptions: Array<{ label: string; value: CostMode }> = [
  { label: 'USD', value: 'usd' },
  { label: 'Tokens', value: 'tokens' },
];

const latencyPercentileOptions: Array<{ label: string; value: LatencyPercentile }> = [
  { label: 'P50', value: 'p50' },
  { label: 'P95', value: 'p95' },
  { label: 'P99', value: 'p99' },
];

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };

export function DashboardGrid({
  dataSource, filters, breakdownBy, latencyPercentile, costMode,
  from, to, timeRange, onLatencyPercentileChange, onCostModeChange,
}: DashboardGridProps) {
  const styles = useStyles2(getStyles);
  const hasBreakdown = breakdownBy !== 'none';

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  const statPluginId = hasBreakdown ? 'piechart' : 'stat';
  const statOptions = hasBreakdown
    ? {
        pieType: 'pie',
        displayLabels: [],
        legend: { displayMode: 'table', placement: 'right', values: ['percent'], calcs: [], width: 200 },
        tooltip: { mode: 'single', sort: 'desc' },
        reduceOptions: { calcs: ['lastNotNull'] },
      }
    : { textMode: 'value', reduceOptions: { calcs: ['lastNotNull'] } };

  // --- Stat queries (instant) ---
  const totalOps = usePrometheusQuery(
    dataSource,
    totalOpsQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );
  const errRate = usePrometheusQuery(
    dataSource,
    errorRateQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );
  const latencyQuantileMap: Record<LatencyPercentile, number> = { p50: 0.5, p95: 0.95, p99: 0.99 };
  const latencyStat = usePrometheusQuery(
    dataSource,
    latencyStatQuery(filters, rangeDuration, breakdownBy, latencyQuantileMap[latencyPercentile]),
    from,
    to,
    'instant'
  );
  const costTokens = usePrometheusQuery(
    dataSource,
    tokensByModelAndTypeQuery(filters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  // --- Requests over time ---
  const requestsSuccess = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : requestsSuccessOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const requestsError = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : requestsErrorOverTimeQuery(filters, interval),
    from,
    to,
    'range',
    step
  );
  const requestsBroken = usePrometheusQuery(
    dataSource,
    hasBreakdown ? requestsOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Errors over time ---
  const errorsTimeseries = usePrometheusQuery(
    dataSource,
    errorsByCodeOverTimeQuery(filters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Latency over time ---
  const latencyQuery = latencyOverTimeQuery(filters, interval, breakdownBy, latencyQuantileMap[latencyPercentile]);
  const latencyTimeseries = usePrometheusQuery(dataSource, latencyQuery, from, to, 'range', step);

  // --- Cost over time (with breakdown support) ---
  const costOverTime = usePrometheusQuery(
    dataSource,
    costMode === 'usd' ? tokensByModelAndTypeOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Token totals (for tokens mode) ---
  const tokensStat = usePrometheusQuery(
    dataSource,
    costMode === 'tokens' ? totalTokensQuery(filters, rangeDuration, breakdownBy) : '',
    from,
    to,
    'instant'
  );
  const tokensOverTime = usePrometheusQuery(
    dataSource,
    costMode === 'tokens' ? totalTokensOverTimeQuery(filters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Computed cost ---
  const costTokensData = costTokens.data ?? undefined;
  const costOverTimeData = costOverTime.data ?? undefined;

  const resolvePairs = useMemo(() => {
    const pairs: ModelResolvePair[] = [];
    pairs.push(...extractResolvePairs(costTokensData));
    pairs.push(...extractResolvePairs(costOverTimeData));
    return pairs;
  }, [costTokensData, costOverTimeData]);
  const resolvedPricing = useResolvedModelPricing(dataSource, resolvePairs);

  const totalCost = useMemo(() => {
    return calculateTotalCost(costTokensData, resolvedPricing.pricingMap);
  }, [costTokensData, resolvedPricing.pricingMap]);

  const breakdownPromLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;

  const costStatData = useMemo(() => {
    if (costMode === 'tokens') {
      if (hasBreakdown && tokensStat.data) {
        return [vectorToPieDataFrame(tokensStat.data, [breakdownPromLabel!])];
      }
      return [statValueToDataFrame(tokensStat.data ? vectorToStatValue(tokensStat.data) : 0, 'Tokens')];
    }
    if (!hasBreakdown || !breakdownPromLabel) {
      return [statValueToDataFrame(totalCost.totalCost, 'Cost', 'currencyUSD')];
    }
    const grouped = calculateTotalCostByGroup(costTokensData, resolvedPricing.pricingMap, breakdownPromLabel);
    if (grouped.length === 0) {
      return [statValueToDataFrame(0, 'Cost', 'currencyUSD')];
    }
    const frame = new MutableDataFrame({
      fields: grouped.map((g) => ({
        name: g.label,
        type: FieldType.number,
        values: [g.cost],
        config: { unit: 'currencyUSD', displayName: g.label },
      })),
    });
    return [frame];
  }, [costMode, hasBreakdown, breakdownPromLabel, totalCost.totalCost, costTokensData, resolvedPricing.pricingMap, tokensStat.data]);

  const costGroupByLabel = hasBreakdown ? breakdownToPromLabel[breakdownBy] : undefined;
  const costTimeSeries = useMemo(() => {
    if (costMode === 'tokens') {
      return tokensOverTime.data ? matrixToDataFrames(tokensOverTime.data) : [];
    }
    if (!costOverTimeData) {
      return [];
    }
    return calculateCostTimeSeries(costOverTimeData, resolvedPricing.pricingMap, costGroupByLabel);
  }, [costMode, costOverTimeData, resolvedPricing.pricingMap, costGroupByLabel, tokensOverTime.data]);

  const costLoading = costMode === 'tokens'
    ? tokensOverTime.loading
    : costTokens.loading || resolvedPricing.loading;
  const costSeriesLoading = costMode === 'tokens'
    ? tokensOverTime.loading
    : costOverTime.loading || resolvedPricing.loading;

  // --- Build request chart data ---
  const requestsData = useMemo(() => {
    if (hasBreakdown) {
      return requestsBroken.data ? matrixToDataFrames(requestsBroken.data) : [];
    }
    const frames = [];
    if (requestsSuccess.data) {
      const successFrames = matrixToDataFrames(requestsSuccess.data);
      for (const f of successFrames) {
        f.name = 'Success';
        if (f.fields[1]) {
          f.fields[1].config = { ...f.fields[1].config, displayName: 'Success' };
        }
      }
      frames.push(...successFrames);
    }
    if (requestsError.data) {
      const errorFrames = matrixToDataFrames(requestsError.data);
      for (const f of errorFrames) {
        f.name = 'Errors';
        if (f.fields[1]) {
          f.fields[1].config = { ...f.fields[1].config, displayName: 'Errors' };
        }
      }
      frames.push(...errorFrames);
    }
    return frames;
  }, [hasBreakdown, requestsBroken.data, requestsSuccess.data, requestsError.data]);

  const requestsLoading = hasBreakdown ? requestsBroken.loading : requestsSuccess.loading || requestsError.loading;
  const requestsErr = hasBreakdown ? requestsBroken.error : requestsSuccess.error || requestsError.error;

  const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
  const timeseriesOptions = {
    legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
    tooltip: { mode: 'multi', sort: 'desc' },
  };

  const allDataLoading = totalOps.loading || errRate.loading || requestsLoading
    || errorsTimeseries.loading || latencyStat.loading || latencyTimeseries.loading
    || costLoading || costSeriesLoading;
  const insightDataContext = useMemo(() => {
    if (allDataLoading) {
      return null;
    }
    const requestsSource = hasBreakdown ? requestsBroken.data : requestsSuccess.data;
    const hasAnyData = hasResponseData(totalOps.data)
      || hasResponseData(requestsSource)
      || hasResponseData(latencyStat.data)
      || hasResponseData(latencyTimeseries.data);
    if (!hasAnyData) {
      return null;
    }
    const parts = [
      summarizeVector(totalOps.data, 'Total Requests'),
      summarizeVector(errRate.data, 'Error Rate (%)'),
      summarizeMatrix(requestsSource, 'Requests over time'),
      summarizeMatrix(errorsTimeseries.data, 'Errors over time'),
      summarizeVector(latencyStat.data, `Latency ${latencyPercentile} (seconds)`),
      summarizeMatrix(latencyTimeseries.data, 'Latency over time'),
    ];
    if (costMode === 'tokens') {
      parts.push(summarizeVector(tokensStat.data, 'Total Tokens'));
      parts.push(summarizeMatrix(tokensOverTime.data, 'Tokens over time'));
    } else {
      parts.push(`Estimated total cost (USD): $${totalCost.totalCost.toFixed(4)}`);
      parts.push(summarizeVector(costTokens.data, 'Token usage by model'));
    }
    return parts.join('\n');
  }, [allDataLoading, totalOps.data, errRate.data, hasBreakdown, requestsBroken.data, requestsSuccess.data, errorsTimeseries.data, latencyStat.data, latencyPercentile, latencyTimeseries.data, costMode, tokensStat.data, tokensOverTime.data, totalCost.totalCost, costTokens.data]);

  const insightPrompt = `Analyze this GenAI observability dashboard. Breakdown: ${breakdownBy}. Latency percentile: ${latencyPercentile}. Cost mode: ${costMode}. Only flag significant findings — anomalies, outliers, or actionable issues. Skip anything that looks normal.`;

  return (
    <div className={styles.gridOuter}>
      <div className={styles.grid}>
        {/* Row 1: Requests & Errors */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <SectionHeader icon="graph-bar" title="Requests" styles={styles} />
            <SectionHeader icon="bug" title="Errors" styles={styles} />
          </div>
          <div className={styles.panelRow}>
            <MetricPanel
              title="Requests/s"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={requestsLoading}
              error={requestsErr}
              data={requestsData}
              options={timeseriesOptions}
              fieldConfig={{
                defaults: { unit: 'reqps', color: consistentColor, custom: timeseriesDefaults, thresholds: noThresholds },
                overrides: [],
              }}
            />
            <MetricPanel
              title="Total Requests"
              pluginId={statPluginId}
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={totalOps.loading}
              error={totalOps.error}
              options={statOptions}
              data={
                hasBreakdown && totalOps.data
                  ? [vectorToPieDataFrame(totalOps.data, [breakdownPromLabel!])]
                  : [statValueToDataFrame(totalOps.data ? vectorToStatValue(totalOps.data) : 0, 'Requests')]
              }
              fieldConfig={{ defaults: { min: 0, color: consistentColor, thresholds: noThresholds }, overrides: [] }}
            />
            <MetricPanel
              title="Error rate"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={errorsTimeseries.loading}
              error={errorsTimeseries.error}
              data={errorsTimeseries.data ? matrixToDataFrames(errorsTimeseries.data) : []}
              options={timeseriesOptions}
              fieldConfig={{
                defaults: {
                  unit: 'reqps',
                  color: consistentColor,
                  custom: timeseriesDefaults,
                  thresholds: noThresholds,
                },
                overrides: [],
              }}
            />
            <MetricPanel
              title="Error Rate"
              pluginId={statPluginId}
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={errRate.loading}
              error={errRate.error}
              options={statOptions}
              data={
                hasBreakdown && errRate.data
                  ? [vectorToPieDataFrame(errRate.data, [breakdownPromLabel!])]
                  : [statValueToDataFrame(errRate.data ? vectorToStatValue(errRate.data) : 0, 'Error Rate', 'percent')]
              }
              fieldConfig={{ defaults: { unit: 'percent', min: 0, color: consistentColor, thresholds: noThresholds }, overrides: [] }}
            />
          </div>
        </section>

        {/* Row 2: Latency & Cost */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <SectionHeader
              icon="clock-nine"
              title="Latency"
              styles={styles}
              extra={
                <Select
                  options={latencyPercentileOptions}
                  value={latencyPercentile}
                  onChange={(v) => { if (v.value) { onLatencyPercentileChange(v.value); } }}
                  width={10}
                />
              }
            />
            <SectionHeader
              icon="credit-card"
              title="Cost"
              styles={styles}
              extra={
                <Select
                  options={costModeOptions}
                  value={costMode}
                  onChange={(v) => { if (v.value) { onCostModeChange(v.value); } }}
                  width={12}
                />
              }
            />
          </div>
          <div className={styles.panelRow}>
            <MetricPanel
              title={latencyPercentile.toUpperCase()}
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={latencyTimeseries.loading}
              error={latencyTimeseries.error}
              data={latencyTimeseries.data ? matrixToDataFrames(latencyTimeseries.data) : []}
              options={timeseriesOptions}
              fieldConfig={{
                defaults: { unit: 's', color: consistentColor, custom: timeseriesDefaults, thresholds: noThresholds },
                overrides: [],
              }}
            />
            <MetricPanel
              title={latencyPercentile.toUpperCase()}
              pluginId={statPluginId}
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={latencyStat.loading}
              error={latencyStat.error}
              options={statOptions}
              data={
                hasBreakdown && latencyStat.data
                  ? [vectorToPieDataFrame(latencyStat.data, [breakdownPromLabel!])]
                  : [statValueToDataFrame(latencyStat.data ? vectorToStatValue(latencyStat.data) : 0, 'Latency', 's')]
              }
              fieldConfig={{ defaults: { unit: 's', min: 0, color: consistentColor, thresholds: noThresholds }, overrides: [] }}
            />
            <MetricPanel
              title={costMode === 'tokens' ? 'Tokens' : 'USD'}
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={costSeriesLoading}
              error={costMode === 'tokens' ? tokensOverTime.error : costOverTime.error}
              data={costTimeSeries}
              options={timeseriesOptions}
              fieldConfig={{
                defaults: {
                  unit: costMode === 'tokens' ? 'short' : 'currencyUSD',
                  color: consistentColor,
                  custom: timeseriesDefaults,
                  thresholds: noThresholds,
                },
                overrides: [],
              }}
            />
            <MetricPanel
              title={costMode === 'tokens' ? 'Total Tokens' : 'Estimated USD'}
              pluginId={statPluginId}
              height={CHART_HEIGHT}
              timeRange={timeRange}
              loading={costMode === 'tokens' ? tokensStat.loading : costLoading}
              error={costMode === 'tokens' ? tokensStat.error : costTokens.error}
              options={statOptions}
              data={costStatData}
              fieldConfig={{ defaults: { unit: costMode === 'tokens' ? 'short' : 'currencyUSD', min: 0, color: consistentColor, thresholds: noThresholds }, overrides: [] }}
            />
          </div>
        </section>
      </div>

      <InsightPanel
        prompt={insightPrompt}
        origin="sigil-plugin/dashboard-insight"
        dataContext={insightDataContext}
      />
    </div>
  );
}

type SectionHeaderProps = {
  icon: IconName;
  title: string;
  styles: ReturnType<typeof getStyles>;
  extra?: React.ReactNode;
};

function SectionHeader({ icon, title, styles, extra }: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionHeaderIcon}>
        <Icon name={icon} size="lg" />
      </div>
      <span className={styles.sectionHeaderTitle}>{title}</span>
      {extra && <div className={styles.sectionHeaderExtra}>{extra}</div>}
    </div>
  );
}

type InsightPanelProps = {
  prompt: string;
  origin: string;
  dataContext: string | null;
};

function InsightPanel({ prompt, origin, dataContext }: InsightPanelProps) {
  const styles = useStyles2(getStyles);
  const gen = useInlineAssistant();
  const [text, setText] = useState('');
  const hasAutoRun = useRef(false);

  const latestRef = useRef({ prompt, origin, dataContext, gen });
  useEffect(() => {
    latestRef.current = { prompt, origin, dataContext, gen };
  });

  const runGenerate = useCallback((ctx: string) => {
    const { prompt: p, origin: o, gen: g } = latestRef.current;
    const fullPrompt = `${p}\n\nDashboard data:\n${ctx}`;
    g.generate({
      prompt: fullPrompt,
      origin: o,
      systemPrompt: 'You are an observability analyst. Provide 2-3 short bullet points highlighting only the most important findings: anomalies, spikes, or key metrics. Use **bold** for numbers. One line per bullet.',
      onComplete: (result: string) => setText(result),
      onError: (err: Error) => console.error('Insight generation failed:', err),
    });
  }, []);

  useEffect(() => {
    if (!dataContext || hasAutoRun.current) {
      return;
    }
    hasAutoRun.current = true;
    runGenerate(dataContext);
  }, [dataContext, runGenerate]);

  const doGenerate = useCallback(() => {
    const { dataContext: ctx, gen: g } = latestRef.current;
    if (ctx && !g.isGenerating) {
      setText('');
      runGenerate(ctx);
    }
  }, [runGenerate]);

  const displayText = gen.isGenerating ? gen.content : text;
  const initialWaiting = !dataContext && !text && !gen.isGenerating;
  const hasResult = Boolean(text) || gen.isGenerating;
  const showRegenerate = !gen.isGenerating && hasResult;

  const renderedHtml = useMemo(() => {
    if (!displayText) {
      return '';
    }
    const escaped = textUtil.escapeHtml(displayText);
    const html = escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n/g, '<br/>');
    return html;
  }, [displayText]);

  return (
    <div className={styles.insightPanel}>
      <div className={styles.insightPanelHeader}>
        <Icon name="ai" size="md" />
        <span>Assistant Insight</span>
        {(gen.isGenerating || initialWaiting) && <Spinner size="sm" />}
        {showRegenerate && (
          <IconButton
            name="repeat"
            aria-label="Rerun insight"
            tooltip="Rerun"
            size="md"
            onClick={doGenerate}
            className={styles.regenerateButton}
          />
        )}
      </div>
      <div className={styles.insightPanelBody}>
        {initialWaiting
          ? 'Waiting for data...'
          : renderedHtml
            ? <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            : 'Generating insight...'}
      </div>
    </div>
  );
}

function hasResponseData(response: PrometheusQueryResponse | null | undefined): boolean {
  if (!response) {
    return false;
  }
  if (response.data.resultType !== 'vector' && response.data.resultType !== 'matrix') {
    return false;
  }
  return response.data.result.length > 0;
}

function summarizeVector(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'vector') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
  if (results.length === 0) {
    return `${label}: 0`;
  }
  if (results.length === 1) {
    return `${label}: ${results[0].value[1]}`;
  }
  const lines = results.map((r) => {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `  ${tags || 'total'}: ${r.value[1]}`;
  });
  return `${label} (by series):\n${lines.join('\n')}`;
}

function summarizeMatrix(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'matrix') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  if (results.length === 0) {
    return `${label}: no series`;
  }
  const lines = results.map((r) => {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const vals = r.values;
    const last = vals.length > 0 ? vals[vals.length - 1][1] : 'N/A';
    const first = vals.length > 0 ? vals[0][1] : 'N/A';
    return `  ${tags || 'total'}: first=${first}, last=${last}, points=${vals.length}`;
  });
  return `${label} (${results.length} series):\n${lines.join('\n')}`;
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

function getStyles(theme: GrafanaTheme2) {
  return {
    gridOuter: css({
      display: 'flex',
      gap: theme.spacing(2),
    }),
    grid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
      flex: 1,
      minWidth: 0,
    }),
    section: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    sectionHeaderRow: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(1),
    }),
    sectionHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1, 0),
    }),
    sectionHeaderIcon: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 32,
      height: 32,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
    }),
    sectionHeaderTitle: css({
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      letterSpacing: '-0.01em',
    }),
    sectionHeaderExtra: css({
      marginLeft: theme.spacing(0.5),
    }),
    panelRow: css({
      display: 'grid',
      gridTemplateColumns: '5fr 4fr 5fr 4fr',
      gap: theme.spacing(1),
    }),
    insightPanel: css({
      width: 280,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    insightPanelHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(1, 1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
    }),
    regenerateButton: css({
      marginLeft: 'auto',
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    insightPanelBody: css({
      flex: 1,
      padding: theme.spacing(1.5),
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.7,
      color: theme.colors.text.primary,
      overflowY: 'auto',
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.maxContrast,
      },
      '& em': {
        fontStyle: 'italic',
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.secondary,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
      '& ul': {
        margin: `${theme.spacing(0.5)} 0`,
        paddingLeft: theme.spacing(2),
      },
      '& li': {
        marginBottom: theme.spacing(0.5),
      },
      '& br': {
        display: 'block',
        content: '""',
        marginTop: theme.spacing(0.25),
      },
    }),
  };
}
