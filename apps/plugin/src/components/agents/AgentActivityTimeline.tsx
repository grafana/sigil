import React, { useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import {
  dateTime,
  FieldType,
  MutableDataFrame,
  ThresholdsMode,
  type AbsoluteTimeRange,
  type DataFrame,
  type FieldConfigSource,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import type { DashboardDataSource } from '../../dashboard/api';
import { requestCountOverTimeQuery } from '../../dashboard/queries';
import { emptyFilters, type PrometheusMatrixResult, type PrometheusQueryResponse } from '../../dashboard/types';
import { usePrometheusQuery } from '../dashboard/usePrometheusQuery';
import { MetricPanel } from '../dashboard/MetricPanel';

const PANEL_HEIGHT = 220;
const TARGET_BARS = 40;

function computeBarStep(fromSec: number, toSec: number): number {
  const rangeSec = toSec - fromSec;
  return Math.max(Math.ceil(rangeSec / TARGET_BARS), 60);
}

function matrixToStackedDataFrames(response: PrometheusQueryResponse): DataFrame[] {
  if (response.data.resultType !== 'matrix') {
    return [];
  }
  const results = response.data.result as PrometheusMatrixResult[];

  const totals = results.map((series) => {
    let sum = 0;
    for (const [, val] of series.values) {
      sum += parseFloat(val) || 0;
    }
    return { series, sum };
  });
  totals.sort((a, b) => b.sum - a.sum);

  return totals.map(({ series }) => {
    const agentName = series.metric.gen_ai_agent_name || 'anonymous';
    const times: number[] = [];
    const values: number[] = [];
    for (const [ts, val] of series.values) {
      times.push(ts * 1000);
      const v = parseFloat(val);
      values.push(Number.isFinite(v) ? Math.round(v) : 0);
    }
    return new MutableDataFrame({
      name: agentName,
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        {
          name: 'Value',
          type: FieldType.number,
          values,
          labels: series.metric,
          config: { displayName: agentName },
        },
      ],
    });
  });
}

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const panelOptions = {
  legend: { displayMode: 'list', placement: 'bottom', calcs: [] },
  tooltip: { mode: 'multi', sort: 'desc' },
};

const fieldConfig: FieldConfigSource = {
  defaults: {
    unit: 'short',
    decimals: 0,
    min: 0,
    thresholds: noThresholds,
    color: { mode: 'palette-classic' },
    custom: {
      drawStyle: 'bars',
      fillOpacity: 70,
      lineWidth: 0,
      gradientMode: 'none',
      stacking: { mode: 'normal', group: 'A' },
      barAlignment: 0,
      thresholdsStyle: { mode: 'off' },
    },
  },
  overrides: [],
};

export type AgentActivityTimelineProps = {
  dashboardDataSource: DashboardDataSource;
  timeRange: TimeRange;
  loading?: boolean;
  onTimeRangeChange?: (timeRange: TimeRange) => void;
};

export function AgentActivityTimeline({
  dashboardDataSource,
  timeRange,
  loading: externalLoading,
  onTimeRangeChange,
}: AgentActivityTimelineProps) {
  const styles = useStyles2(getStyles);
  const fromSec = Math.floor(timeRange.from.valueOf() / 1000);
  const toSec = Math.floor(timeRange.to.valueOf() / 1000);
  const step = useMemo(() => computeBarStep(fromSec, toSec), [fromSec, toSec]);
  const stepInterval = `${step}s`;
  const query = useMemo(() => requestCountOverTimeQuery(emptyFilters, stepInterval, 'agent'), [stepInterval]);

  const { data, loading: queryLoading } = usePrometheusQuery(dashboardDataSource, query, fromSec, toSec, 'range', step);

  const dataFrames = useMemo(() => {
    if (!data) {
      return [];
    }
    return matrixToStackedDataFrames(data);
  }, [data]);

  const isLoading = queryLoading || (externalLoading ?? false);

  const handlePanelTimeRangeChange = useCallback(
    (abs: AbsoluteTimeRange) => {
      if (!onTimeRangeChange) {
        return;
      }
      const f = dateTime(abs.from);
      const t = dateTime(abs.to);
      onTimeRangeChange({ from: f, to: t, raw: { from: f.toISOString(), to: t.toISOString() } });
    },
    [onTimeRangeChange]
  );

  return (
    <div className={styles.container}>
      <MetricPanel
        title="Agent activity over time"
        description="Generation count per interval, broken down by agent."
        pluginId="timeseries"
        data={dataFrames}
        loading={isLoading}
        height={PANEL_HEIGHT}
        timeRange={timeRange}
        onChangeTimeRange={onTimeRangeChange ? handlePanelTimeRangeChange : undefined}
        options={panelOptions}
        fieldConfig={fieldConfig}
      />
    </div>
  );
}

function getStyles(_theme: GrafanaTheme2) {
  return {
    container: css({
      width: '100%',
      label: 'agentActivityTimeline-container',
      '[data-testid="data-testid panel content"] > div > div:nth-child(2)': {
        height: '1px',
      },
    }),
  };
}
