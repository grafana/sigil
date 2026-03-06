import React, { useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type AbsoluteTimeRange, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Button, Icon, Text, useStyles2 } from '@grafana/ui';
import { Link } from 'react-router-dom';
import type { DashboardDataSource } from '../../dashboard/api';
import type { BreakdownDimension, DashboardFilters } from '../../dashboard/types';
import { computeStep, computeRateInterval, computeRangeDuration } from '../../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../../dashboard/transforms';
import { BreakdownStatPanel, formatWindowLabel } from './dashboardShared';
import { usePrometheusQuery } from './usePrometheusQuery';
import { MetricPanel } from './MetricPanel';
import { TopStat } from '../TopStat';
import {
  emptyEvalFilters,
  totalScoresQuery,
  passRateQuery,
  evalDurationStatQuery,
  totalExecutionsQuery,
  passRateOverTimeQuery,
  scoresOverTimeQuery,
  evalDurationOverTimeQuery,
  executionsIncreaseQuery,
  failedExecutionsIncreaseQuery,
} from '../../evaluation/queries';
import { PLUGIN_BASE, ROUTES } from '../../constants';
import { hasResponseData } from '../insight/summarize';
import { type ConversationsDataSource, defaultConversationsDataSource } from '../../conversation/api';
import { LowestPassRateConversationsTable } from './LowestPassRateConversationsTable';

export type DashboardEvalGridProps = {
  dataSource: DashboardDataSource;
  conversationsDataSource?: ConversationsDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
  onTimeRangeChange: (timeRange: TimeRange) => void;
};

const CHART_HEIGHT = 320;

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const consistentColor = { mode: 'palette-classic-by-name' };
const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2 };
const chartLegend = { displayMode: 'list', placement: 'bottom', calcs: [] };
const tooltipOptions = { mode: 'multi', sort: 'desc' };

export function DashboardEvalGrid({
  dataSource,
  conversationsDataSource = defaultConversationsDataSource,
  filters,
  breakdownBy,
  from,
  to,
  timeRange,
  onTimeRangeChange,
}: DashboardEvalGridProps) {
  const styles = useStyles2(getStyles);
  const evalFilters = emptyEvalFilters;
  const evalBreakdown =
    breakdownBy === 'none'
      ? 'none'
      : breakdownBy === 'provider'
        ? 'provider'
        : breakdownBy === 'agent'
          ? 'agent'
          : 'model';

  const handlePanelTimeRangeChange = useCallback(
    (abs: AbsoluteTimeRange) => {
      const f = dateTime(abs.from);
      const t = dateTime(abs.to);
      onTimeRangeChange({ from: f, to: t, raw: { from: f.toISOString(), to: t.toISOString() } });
    },
    [onTimeRangeChange]
  );

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  const hasBreakdown = breakdownBy !== 'none';

  // --- Top stats ---
  const topTotalScores = usePrometheusQuery(
    dataSource,
    totalScoresQuery(filters, evalFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const topPassRate = usePrometheusQuery(
    dataSource,
    passRateQuery(filters, evalFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const topDuration = usePrometheusQuery(
    dataSource,
    evalDurationStatQuery(filters, evalFilters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );
  const topTotalExecs = usePrometheusQuery(
    dataSource,
    totalExecutionsQuery(filters, evalFilters, rangeDuration),
    from,
    to,
    'instant'
  );

  // --- Comparison ---
  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
  const prevTotalScores = usePrometheusQuery(
    dataSource,
    totalScoresQuery(filters, evalFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevPassRate = usePrometheusQuery(
    dataSource,
    passRateQuery(filters, evalFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevDuration = usePrometheusQuery(
    dataSource,
    evalDurationStatQuery(filters, evalFilters, rangeDuration, 'none', 0.95),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevTotalExecs = usePrometheusQuery(
    dataSource,
    totalExecutionsQuery(filters, evalFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );

  // --- Pass rate over time ---
  const passRateTimeseries = usePrometheusQuery(
    dataSource,
    passRateOverTimeQuery(filters, evalFilters, interval, evalBreakdown),
    from,
    to,
    'range',
    step
  );

  // --- Score volume (total or by breakdown) ---
  const scoresOverTime = usePrometheusQuery(
    dataSource,
    scoresOverTimeQuery(filters, evalFilters, interval, evalBreakdown),
    from,
    to,
    'range',
    step
  );

  // --- Row 2: Duration + Executions ---
  const durationTimeseries = usePrometheusQuery(
    dataSource,
    evalDurationOverTimeQuery(filters, evalFilters, interval, evalBreakdown, 0.95),
    from,
    to,
    'range',
    step
  );
  const execsOverTime = usePrometheusQuery(
    dataSource,
    executionsIncreaseQuery(filters, evalFilters, interval, evalBreakdown),
    from,
    to,
    'range',
    step
  );
  const failedExecsOverTime = usePrometheusQuery(
    dataSource,
    hasBreakdown ? '' : failedExecutionsIncreaseQuery(filters, evalFilters, interval),
    from,
    to,
    'range',
    step
  );

  // --- Scores by evaluator breakdown ---
  const scoresByEvaluator = usePrometheusQuery(
    dataSource,
    totalScoresQuery(filters, evalFilters, rangeDuration, 'evaluator'),
    from,
    to,
    'instant'
  );

  const scoresData = useMemo(() => {
    return scoresOverTime.data ? matrixToDataFrames(scoresOverTime.data) : [];
  }, [scoresOverTime.data]);

  const execsData = useMemo(() => {
    if (hasBreakdown) {
      return execsOverTime.data ? matrixToDataFrames(execsOverTime.data) : [];
    }
    const frames = [];
    if (execsOverTime.data) {
      const f = matrixToDataFrames(execsOverTime.data);
      for (const frame of f) {
        frame.name = 'Total';
        if (frame.fields[1]) {
          frame.fields[1].config = {
            ...frame.fields[1].config,
            displayName: 'Total',
            color: { mode: 'fixed', fixedColor: 'blue' },
          };
        }
      }
      frames.push(...f);
    }
    if (failedExecsOverTime.data) {
      const f = matrixToDataFrames(failedExecsOverTime.data);
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
  }, [hasBreakdown, execsOverTime.data, failedExecsOverTime.data]);

  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;
  const totalScoresValue = topTotalScores.data ? vectorToStatValue(topTotalScores.data) : 0;
  const passRateValue = topPassRate.data ? vectorToStatValue(topPassRate.data) : 0;
  const durationValue = topDuration.data ? vectorToStatValue(topDuration.data) : 0;
  const totalExecsValue = topTotalExecs.data ? vectorToStatValue(topTotalExecs.data) : 0;
  const prevTotalScoresValue = prevTotalScores.data ? vectorToStatValue(prevTotalScores.data) : 0;
  const prevPassRateValue = prevPassRate.data ? vectorToStatValue(prevPassRate.data) : 0;
  const prevDurationValue = prevDuration.data ? vectorToStatValue(prevDuration.data) : 0;
  const prevTotalExecsValue = prevTotalExecs.data ? vectorToStatValue(prevTotalExecs.data) : 0;

  const allLoaded = !topTotalScores.loading && !scoresByEvaluator.loading;
  const hasData = hasResponseData(topTotalScores.data) || hasResponseData(scoresByEvaluator.data);

  if (allLoaded && !hasData) {
    return (
      <div className={styles.gridWrapper}>
        <div className={styles.emptyState}>
          <Icon name="check-circle" size="xxxl" className={styles.emptyIcon} />
          <Text variant="h4">No evaluation data yet</Text>
          <Text color="secondary" textAlignment="center">
            Set up evaluators and create rules to start scoring your LLM generations automatically. Results will appear
            here once the evaluation pipeline is running.
          </Text>
          <Link to={`${PLUGIN_BASE}/${ROUTES.Evaluation}`}>
            <Button variant="primary" icon="arrow-right">
              Set up evaluation
            </Button>
          </Link>
        </div>
        <LowestPassRateConversationsTable
          conversationsDataSource={conversationsDataSource}
          timeRange={timeRange}
          filters={filters}
        />
      </div>
    );
  }

  return (
    <div className={styles.gridWrapper}>
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
        <TopStat
          label="Total Executions"
          value={totalExecsValue}
          loading={topTotalExecs.loading}
          prevValue={prevTotalExecsValue}
          prevLoading={prevTotalExecs.loading}
          comparisonLabel={comparisonLabel}
        />
        <Link to={`${PLUGIN_BASE}/${ROUTES.Evaluation}/results`} className={styles.viewResultsLink}>
          View all results
          <Icon name="arrow-right" size="sm" />
        </Link>
      </div>

      <div className={styles.grid}>
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
          <MetricPanel
            title="Score Volume"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={scoresOverTime.loading}
            error={scoresOverTime.error}
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
          <BreakdownStatPanel
            title="Scores by Evaluator"
            data={scoresByEvaluator.data}
            loading={scoresByEvaluator.loading}
            error={scoresByEvaluator.error}
            breakdownLabel="evaluator"
            height={CHART_HEIGHT}
          />
        </div>

        <div className={styles.panelRowEqual}>
          <MetricPanel
            title="Eval Duration (P95)"
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
          />
          <MetricPanel
            title="Executions"
            pluginId="timeseries"
            height={CHART_HEIGHT}
            timeRange={timeRange}
            onChangeTimeRange={handlePanelTimeRangeChange}
            loading={execsOverTime.loading}
            error={execsOverTime.error}
            data={execsData}
            options={{ legend: chartLegend, tooltip: tooltipOptions }}
            fieldConfig={{
              defaults: {
                unit: 'short',
                decimals: 0,
                color: consistentColor,
                custom: {
                  ...timeseriesDefaults,
                  drawStyle: 'bars',
                  fillOpacity: 80,
                  lineWidth: 0,
                  stacking: { mode: 'normal' },
                },
                thresholds: noThresholds,
              },
              overrides: [],
            }}
          />
        </div>

        <LowestPassRateConversationsTable
          conversationsDataSource={conversationsDataSource}
          timeRange={timeRange}
          filters={filters}
        />
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
      alignItems: 'flex-end',
      gap: theme.spacing(4),
      padding: theme.spacing(1.5, 0),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    viewResultsLink: css({
      marginLeft: 'auto',
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
      textDecoration: 'none',
      padding: theme.spacing(0.75, 1.5),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      whiteSpace: 'nowrap',
      transition: 'color 0.15s ease, border-color 0.15s ease, background 0.15s ease',
      '&:hover': {
        color: theme.colors.text.primary,
        borderColor: theme.colors.border.medium,
        background: theme.colors.action.hover,
      },
    }),
    panelRowWithStat: css({
      display: 'grid',
      gridTemplateColumns: '2fr 3fr 3fr',
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
