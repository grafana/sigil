import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, ThresholdsMode, type GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { useNavigate } from 'react-router-dom';
import { TopStat } from '../components/TopStat';
import { MetricPanel } from '../components/dashboard/MetricPanel';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultDashboardDataSource } from '../dashboard/api';
import {
  computeRangeDuration,
  computeRateInterval,
  computeStep,
  errorRateOverTimeQuery,
  errorRateQuery,
  latencyOverTimeQuery,
  latencyStatQuery,
  requestsOverTimeQuery,
  totalOpsQuery,
  totalTokensQuery,
  totalTokensOverTimeQuery,
} from '../dashboard/queries';
import { matrixToDataFrames, vectorToStatValue } from '../dashboard/transforms';
import { emptyFilters } from '../dashboard/types';

const ASSISTANT_ORIGIN = 'grafana/sigil-plugin/landing';
const CHART_HEIGHT = 170;
const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};
const consistentColor = { mode: 'palette-classic-by-name' };
const timeseriesDefaults = { fillOpacity: 6, showPoints: 'never', lineWidth: 2, axisPlacement: 'hidden' };
const chartOptions = {
  legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
  tooltip: { mode: 'multi', sort: 'desc' },
};
const CHART_WINDOW_SECONDS = 60 * 60;
const CHART_WINDOW_LABEL = 'Last 1 hour';

export default function LandingPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const [to] = useState(() => Math.floor(Date.now() / 1000));
  const from = to - CHART_WINDOW_SECONDS;
  const step = useMemo(() => computeStep(from, to), [from, to]);
  const interval = useMemo(() => computeRateInterval(step), [step]);
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);
  const chartTimeRange = useMemo(
    () => ({
      from: dateTime(from * 1000),
      to: dateTime(to * 1000),
      raw: { from: 'now-24h', to: 'now' },
    }),
    [from, to]
  );

  const totalRequests = usePrometheusQuery(
    defaultDashboardDataSource,
    totalOpsQuery(emptyFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const latencyP95 = usePrometheusQuery(
    defaultDashboardDataSource,
    latencyStatQuery(emptyFilters, rangeDuration, 'none', 0.95),
    from,
    to,
    'instant'
  );
  const errorRate = usePrometheusQuery(
    defaultDashboardDataSource,
    errorRateQuery(emptyFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const totalTokens = usePrometheusQuery(
    defaultDashboardDataSource,
    totalTokensQuery(emptyFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const requestsOverTime = usePrometheusQuery(
    defaultDashboardDataSource,
    requestsOverTimeQuery(emptyFilters, interval, 'none'),
    from,
    to,
    'range',
    step
  );
  const latencyOverTime = usePrometheusQuery(
    defaultDashboardDataSource,
    latencyOverTimeQuery(emptyFilters, interval, 'none', 0.95),
    from,
    to,
    'range',
    step
  );
  const errorsOverTime = usePrometheusQuery(
    defaultDashboardDataSource,
    errorRateOverTimeQuery(emptyFilters, interval, 'none'),
    from,
    to,
    'range',
    step
  );
  const tokensOverTime = usePrometheusQuery(
    defaultDashboardDataSource,
    totalTokensOverTimeQuery(emptyFilters, interval),
    from,
    to,
    'range',
    step
  );

  return (
    <div className={styles.container}>
      <LandingTopBar
        assistantOrigin={ASSISTANT_ORIGIN}
        requestsDataSource={defaultDashboardDataSource}
        requestsFrom={from}
        requestsTo={to}
      />
      <section className={styles.section} aria-label="Analytics overview highlights">
        <div className={styles.statsRow}>
          <TopStat
            label="Total Requests"
            value={totalRequests.data ? vectorToStatValue(totalRequests.data) : 0}
            loading={totalRequests.loading}
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=overview`}
            linkLabel="Overview analytics"
          />
          <TopStat
            label="Avg Latency (P95)"
            value={latencyP95.data ? vectorToStatValue(latencyP95.data) : 0}
            unit="s"
            loading={latencyP95.loading}
            invertChange
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=performance`}
            linkLabel="Performance analytics"
          />
          <TopStat
            label="Error Rate"
            value={errorRate.data ? vectorToStatValue(errorRate.data) : 0}
            unit="percent"
            loading={errorRate.loading}
            invertChange
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=errors`}
            linkLabel="Error analytics"
          />
          <TopStat
            label="Total Tokens"
            value={totalTokens.data ? vectorToStatValue(totalTokens.data) : 0}
            unit="short"
            loading={totalTokens.loading}
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=usage`}
            linkLabel="Usage analytics"
          />
        </div>
        <div className={styles.chartRow}>
          <div className={styles.chartCrop}>
            <MetricPanel
              title="Requests/s"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={chartTimeRange}
              loading={requestsOverTime.loading}
              error={requestsOverTime.error}
              data={requestsOverTime.data ? matrixToDataFrames(requestsOverTime.data) : []}
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
          </div>
          <div className={styles.chartCrop}>
            <MetricPanel
              title="Latency (P95)"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={chartTimeRange}
              loading={latencyOverTime.loading}
              error={latencyOverTime.error}
              data={latencyOverTime.data ? matrixToDataFrames(latencyOverTime.data) : []}
              options={chartOptions}
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
          </div>
          <div className={styles.chartCrop}>
            <MetricPanel
              title="Error rate"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={chartTimeRange}
              loading={errorsOverTime.loading}
              error={errorsOverTime.error}
              data={errorsOverTime.data ? matrixToDataFrames(errorsOverTime.data) : []}
              options={chartOptions}
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
          </div>
          <div className={styles.chartCrop}>
            <MetricPanel
              title="Tokens/s"
              pluginId="timeseries"
              height={CHART_HEIGHT}
              timeRange={chartTimeRange}
              loading={tokensOverTime.loading}
              error={tokensOverTime.error}
              data={tokensOverTime.data ? matrixToDataFrames(tokensOverTime.data) : []}
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
          </div>
        </div>
        <div className={styles.footerRow}>
          <Button variant="primary" onClick={() => navigate(`${PLUGIN_BASE}/${ROUTES.Analytics}`)}>
            Open detailed overview
          </Button>
          <div className={styles.timePeriod}>Time period: {CHART_WINDOW_LABEL}</div>
        </div>
      </section>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
    }),
    section: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: theme.spacing(2.5),
      width: '100%',
      background: `linear-gradient(180deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2.5),
      boxShadow: theme.shadows.z1,
      // Keep chart rendering defaults but hide the legend row entirely.
      '& :global(.viz-legend)': {
        display: 'none',
      },
      '& :global(.panel-legend)': {
        display: 'none',
      },
      '& :global([class*="viz-legend"])': {
        display: 'none',
      },
    }),
    statsRow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))',
      gap: theme.spacing(4),
      padding: theme.spacing(0.5, 0, 0.75),
      width: '100%',
    }),
    chartRow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: theme.spacing(1),
      width: '100%',
    }),
    chartCrop: css({
      height: CHART_HEIGHT - 30,
      overflow: 'hidden',
    }),
    timePeriod: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
    }),
    footerRow: css({
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(2),
    }),
  };
}
