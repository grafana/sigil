import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Select, Text, useStyles2 } from '@grafana/ui';
import { Link } from 'react-router-dom';
import { type DashboardDataSource, defaultDashboardDataSource } from '../dashboard/api';
import { type DashboardFilters, emptyFilters } from '../dashboard/types';
import { computeStep, computeRateInterval, computeRangeDuration } from '../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../dashboard/transforms';
import { BreakdownStatPanel, formatWindowLabel } from '../components/dashboard/dashboardShared';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { MetricPanel } from '../components/dashboard/MetricPanel';
import { TopStat } from '../components/TopStat';
import { FilterToolbar } from '../components/filters/FilterToolbar';
import { useFilterUrlState } from '../hooks/useFilterUrlState';
import { useCascadingFilterOptions } from '../hooks/useCascadingFilterOptions';
import { PageInsightBar } from '../components/insight/PageInsightBar';
import { hasResponseData } from '../components/insight/summarize';
import { PLUGIN_BASE, ROUTES } from '../constants';
import {
  type EvalBreakdownDimension,
  type EvalFilters,
  evalBreakdownLabel,
  emptyEvalFilters,
  totalScoresQuery,
  passRateQuery,
  evalDurationStatQuery,
  passedOverTimeQuery,
  failedOverTimeQuery,
  passRateOverTimeQuery,
  scoresOverTimeQuery,
  evalDurationOverTimeQuery,
} from '../evaluation/queries';

export type EvalResultsPageProps = {
  dataSource?: DashboardDataSource;
};

type LatencyPercentile = 'p50' | 'p95' | 'p99';

const breakdownOptions: Array<{ label: string; value: EvalBreakdownDimension }> = Object.entries(
  evalBreakdownLabel
).map(([value, label]) => ({ label, value: value as EvalBreakdownDimension }));

const latencyPercentileOptions: Array<{ label: string; value: LatencyPercentile }> = [
  { label: 'P50', value: 'p50' },
  { label: 'P95', value: 'p95' },
  { label: 'P99', value: 'p99' },
];

const CHART_HEIGHT = 320;

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };
const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
const chartLegend = { displayMode: 'list', placement: 'bottom', calcs: [] };
const tooltipOptions = { mode: 'multi', sort: 'desc' };

export default function EvalResultsPage({ dataSource = defaultDashboardDataSource }: EvalResultsPageProps) {
  const styles = useStyles2(getStyles);
  const { timeRange, filters, setTimeRange, setFilters } = useFilterUrlState();
  const [breakdownBy, setBreakdownBy] = useState<EvalBreakdownDimension>('evaluator');
  const [latencyPercentile, setLatencyPercentile] = useState<LatencyPercentile>('p95');

  const evalFilters: EvalFilters = emptyEvalFilters;
  const dashFilters: DashboardFilters =
    filters.providers.length || filters.models.length || filters.agentNames.length ? filters : emptyFilters;

  const from = useMemo(() => Math.floor(timeRange.from.valueOf() / 1000), [timeRange]);
  const to = useMemo(() => Math.floor(timeRange.to.valueOf() / 1000), [timeRange]);

  const { providerOptions, modelOptions, agentOptions, labelKeyOptions, labelsLoading } = useCascadingFilterOptions(
    dataSource,
    filters,
    from,
    to
  );

  const handlePanelTimeRangeChange = useCallback(
    (abs: AbsoluteTimeRange) => {
      const f = dateTime(abs.from);
      const t = dateTime(abs.to);
      setTimeRange({ from: f, to: t, raw: { from: f.toISOString(), to: t.toISOString() } });
    },
    [setTimeRange]
  );

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const latencyQuantileMap: Record<LatencyPercentile, number> = { p50: 0.5, p95: 0.95, p99: 0.99 };

  // --- Top stats ---
  const topTotalScores = usePrometheusQuery(
    dataSource,
    totalScoresQuery(dashFilters, evalFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const topPassRate = usePrometheusQuery(
    dataSource,
    passRateQuery(dashFilters, evalFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const topDuration = usePrometheusQuery(
    dataSource,
    evalDurationStatQuery(dashFilters, evalFilters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );

  // --- Previous period for comparison ---
  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
  const prevTotalScores = usePrometheusQuery(
    dataSource,
    totalScoresQuery(dashFilters, evalFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevPassRate = usePrometheusQuery(
    dataSource,
    passRateQuery(dashFilters, evalFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevDuration = usePrometheusQuery(
    dataSource,
    evalDurationStatQuery(dashFilters, evalFilters, rangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );

  // --- Breakdown stat (scores by breakdown dimension) ---
  const scoresByBreakdown = usePrometheusQuery(
    dataSource,
    totalScoresQuery(dashFilters, evalFilters, rangeDuration, breakdownBy),
    from,
    to,
    'instant'
  );

  // --- Pass/fail over time (stacked area when no breakdown) ---
  const hasBreakdown = breakdownBy !== 'none';
  const passedOverTime = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : passedOverTimeQuery(dashFilters, evalFilters, interval),
    from,
    to,
    'range',
    step
  );
  const failedOverTime = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : failedOverTimeQuery(dashFilters, evalFilters, interval),
    from,
    to,
    'range',
    step
  );
  const scoresOverTimeBroken = usePrometheusQuery(
    dataSource,
    hasBreakdown ? scoresOverTimeQuery(dashFilters, evalFilters, interval, breakdownBy) : '',
    from,
    to,
    'range',
    step
  );

  // --- Pass rate over time ---
  const passRateTimeseries = usePrometheusQuery(
    dataSource,
    passRateOverTimeQuery(dashFilters, evalFilters, interval, breakdownBy),
    from,
    to,
    'range',
    step
  );

  // --- Duration over time ---
  const durationTimeseries = usePrometheusQuery(
    dataSource,
    evalDurationOverTimeQuery(dashFilters, evalFilters, interval, breakdownBy, latencyQuantileMap[latencyPercentile]),
    from,
    to,
    'range',
    step
  );

  // --- Build score volume chart data ---
  const scoresData = useMemo(() => {
    if (hasBreakdown) {
      return scoresOverTimeBroken.data ? matrixToDataFrames(scoresOverTimeBroken.data) : [];
    }
    const frames = [];
    if (passedOverTime.data) {
      const f = matrixToDataFrames(passedOverTime.data);
      for (const frame of f) {
        frame.name = 'Passed';
        if (frame.fields[1]) {
          frame.fields[1].config = {
            ...frame.fields[1].config,
            displayName: 'Passed',
            color: { mode: 'fixed', fixedColor: 'green' },
          };
        }
      }
      frames.push(...f);
    }
    if (failedOverTime.data) {
      const f = matrixToDataFrames(failedOverTime.data);
      for (const frame of f) {
        frame.name = 'Failed';
        if (frame.fields[1]) {
          frame.fields[1].config = {
            ...frame.fields[1].config,
            displayName: 'Failed',
            color: { mode: 'fixed', fixedColor: 'red' },
          };
        }
      }
      frames.push(...f);
    }
    return frames;
  }, [hasBreakdown, scoresOverTimeBroken.data, passedOverTime.data, failedOverTime.data]);

  const scoresLoading = hasBreakdown ? scoresOverTimeBroken.loading : passedOverTime.loading || failedOverTime.loading;
  const scoresError = hasBreakdown ? scoresOverTimeBroken.error : passedOverTime.error || failedOverTime.error;

  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;

  const totalScoresValue = topTotalScores.data ? vectorToStatValue(topTotalScores.data) : 0;
  const passRateValue = topPassRate.data ? vectorToStatValue(topPassRate.data) : 0;
  const durationValue = topDuration.data ? vectorToStatValue(topDuration.data) : 0;
  const prevTotalScoresValue = prevTotalScores.data ? vectorToStatValue(prevTotalScores.data) : 0;
  const prevPassRateValue = prevPassRate.data ? vectorToStatValue(prevPassRate.data) : 0;
  const prevDurationValue = prevDuration.data ? vectorToStatValue(prevDuration.data) : 0;

  const breakdownPromLabel = hasBreakdown
    ? breakdownBy === 'model'
      ? 'gen_ai_request_model'
      : breakdownBy === 'agent'
        ? 'gen_ai_agent_name'
        : breakdownBy
    : undefined;

  const allLoaded = !topTotalScores.loading && !scoresByBreakdown.loading;
  const hasData = hasResponseData(topTotalScores.data) || hasResponseData(scoresByBreakdown.data);
  const resultsInsightDataContext = useMemo(() => {
    if (!allLoaded || !hasData) {
      return null;
    }
    const scoreDelta = totalScoresValue - prevTotalScoresValue;
    const passRateDelta = passRateValue - prevPassRateValue;
    const durationDelta = durationValue - prevDurationValue;
    return [
      `Total scores: ${totalScoresValue}`,
      `Previous total scores: ${prevTotalScoresValue}`,
      `Total score delta: ${scoreDelta}`,
      `Pass rate: ${passRateValue}`,
      `Previous pass rate: ${prevPassRateValue}`,
      `Pass rate delta: ${passRateDelta}`,
      `Eval duration p95 seconds: ${durationValue}`,
      `Previous eval duration p95 seconds: ${prevDurationValue}`,
      `Eval duration delta seconds: ${durationDelta}`,
      `Breakdown: ${breakdownBy}`,
      `Latency percentile: ${latencyPercentile}`,
      `Comparison label: ${comparisonLabel}`,
      `Providers selected: ${filters.providers.join(', ') || '(all)'}`,
      `Models selected: ${filters.models.join(', ') || '(all)'}`,
      `Agents selected: ${filters.agentNames.join(', ') || '(all)'}`,
      `Time range seconds: ${windowSize}`,
    ].join('\n');
  }, [
    allLoaded,
    breakdownBy,
    comparisonLabel,
    durationValue,
    filters.agentNames,
    filters.models,
    filters.providers,
    hasData,
    latencyPercentile,
    passRateValue,
    prevDurationValue,
    prevPassRateValue,
    prevTotalScoresValue,
    totalScoresValue,
    windowSize,
  ]);

  if (allLoaded && !hasData) {
    return (
      <div className={styles.emptyState}>
        <Icon name="graph-bar" size="xxxl" className={styles.emptyIcon} />
        <Text variant="h4">No evaluation results yet</Text>
        <Text color="secondary" textAlignment="center">
          Evaluation results will appear here once the pipeline is running. Create evaluators to define scoring
          criteria, then set up rules to connect them to your LLM traffic.
        </Text>
        <Link to={`${PLUGIN_BASE}/${ROUTES.Evaluation}`}>
          <Button variant="primary" icon="arrow-right">
            Set up evaluation
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {resultsInsightDataContext && (
        <PageInsightBar
          prompt="Analyze these evaluation results. Compare the current window to the previous period and focus on meaningful changes in pass rate, score volume, evaluation duration, and breakdown outliers. Call out concrete anomalies or improvement opportunities, and skip anything that looks normal."
          origin="sigil-plugin/evaluation-results-insight"
          dataContext={resultsInsightDataContext}
        />
      )}

      <FilterToolbar
        timeRange={timeRange}
        filters={filters}
        providerOptions={providerOptions}
        modelOptions={modelOptions}
        agentOptions={agentOptions}
        labelKeyOptions={labelKeyOptions}
        labelsLoading={labelsLoading}
        dataSource={dataSource}
        from={from}
        to={to}
        onTimeRangeChange={setTimeRange}
        onFiltersChange={setFilters}
        hideLabelFilters
        fillWidth
      >
        <Select
          options={breakdownOptions}
          value={breakdownBy === 'none' ? null : breakdownBy}
          onChange={(v) => {
            if (v.value) {
              setBreakdownBy(v.value);
            }
          }}
          placeholder="Breakdown by"
          prefix={breakdownBy !== 'none' ? 'Breakdown by' : undefined}
          width={28}
        />
      </FilterToolbar>

      <div className={styles.statsRow}>
        <TopStat
          label="Total Scores"
          value={totalScoresValue}
          loading={topTotalScores.loading}
          prevValue={prevTotalScoresValue}
          prevLoading={prevTotalScores.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Pass Rate"
          value={passRateValue}
          unit="percent"
          loading={topPassRate.loading}
          prevValue={prevPassRateValue}
          prevLoading={prevPassRate.loading}
          comparisonLabel={comparisonLabel}
        />
        <TopStat
          label="Eval Duration (P95)"
          value={durationValue}
          unit="s"
          loading={topDuration.loading}
          prevValue={prevDurationValue}
          prevLoading={prevDuration.loading}
          invertChange
          comparisonLabel={comparisonLabel}
        />
      </div>

      <div className={styles.grid}>
        {/* Row 1: Pass rate trend + scores by breakdown */}
        <div className={styles.panelRowWithStat}>
          <MetricPanel
            title="Pass Rate"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={passRateTimeseries.loading}
            error={passRateTimeseries.error}
            data={passRateTimeseries.data ? matrixToDataFrames(passRateTimeseries.data) : []}
            options={{ legend: chartLegend, tooltip: tooltipOptions }}
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
            title="Scores by Breakdown"
            data={scoresByBreakdown.data}
            loading={scoresByBreakdown.loading}
            error={scoresByBreakdown.error}
            breakdownLabel={breakdownPromLabel}
            height={CHART_HEIGHT}
          />
        </div>

        {/* Row 2: Score volume + eval duration */}
        <div className={styles.panelRowEqual}>
          <MetricPanel
            title="Score Volume"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={scoresLoading}
            error={scoresError}
            data={scoresData}
            options={{ legend: chartLegend, tooltip: tooltipOptions }}
            fieldConfig={{
              defaults: {
                unit: 'short',
                color: consistentColor,
                custom: { ...timeseriesDefaults, stacking: { mode: 'normal' } },
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
          <MetricPanel
            title="Eval Duration"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={durationTimeseries.loading}
            error={durationTimeseries.error}
            data={durationTimeseries.data ? matrixToDataFrames(durationTimeseries.data) : []}
            options={{ legend: chartLegend, tooltip: tooltipOptions }}
            fieldConfig={{
              defaults: {
                unit: 's',
                color: consistentColor,
                custom: timeseriesDefaults,
                thresholds: noThresholds,
              },
              overrides: [],
            }}
            titleItems={
              <Select
                options={latencyPercentileOptions}
                value={latencyPercentile}
                onChange={(v) => {
                  if (v.value) {
                    setLatencyPercentile(v.value);
                  }
                }}
                width={10}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    statsRow: css({
      display: 'flex',
      gap: theme.spacing(4),
      padding: theme.spacing(1.5, 0),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    grid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
    }),
    panelRowWithStat: css({
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: theme.spacing(1),
    }),
    panelRowEqual: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(1),
    }),
    emptyState: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: theme.spacing(2),
      padding: theme.spacing(6, 2),
      maxWidth: 480,
      margin: '0 auto',
    }),
    emptyIcon: css({
      color: theme.colors.text.disabled,
    }),
  };
}
