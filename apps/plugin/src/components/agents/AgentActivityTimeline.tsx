import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import {
  FieldType,
  ThresholdsMode,
  type DataFrame,
  type FieldConfigSource,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import type { AgentListItem } from '../../agents/types';
import { MetricPanel } from '../dashboard/MetricPanel';

const PANEL_HEIGHT = 220;
const MIN_BUCKETS = 12;
const MAX_BUCKETS = 60;

export function computeBucketCount(rangeMs: number): number {
  const oneMinute = 60_000;
  const oneHour = 3_600_000;
  const oneDay = 86_400_000;

  if (rangeMs <= 10 * oneMinute) {
    return MIN_BUCKETS;
  }
  if (rangeMs <= oneHour) {
    return 20;
  }
  if (rangeMs <= 6 * oneHour) {
    return 30;
  }
  if (rangeMs <= oneDay) {
    return 40;
  }
  return MAX_BUCKETS;
}

function bucketAgentActivity(items: AgentListItem[], fromMs: number, toMs: number, bucketCount: number): number[] {
  const rangeMs = toMs - fromMs;
  if (rangeMs <= 0 || bucketCount <= 0) {
    return [];
  }

  const bucketWidth = rangeMs / bucketCount;
  const counts = new Array<number>(bucketCount).fill(0);

  for (const item of items) {
    const ts = Date.parse(item.latest_seen_at);
    if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) {
      continue;
    }
    let idx = Math.floor((ts - fromMs) / bucketWidth);
    if (idx < 0) {
      idx = 0;
    }
    if (idx >= bucketCount) {
      idx = bucketCount - 1;
    }
    counts[idx] += 1;
  }

  return counts;
}

function buildDataFrames(items: AgentListItem[], fromMs: number, toMs: number, bucketCount: number): DataFrame[] {
  const rangeMs = toMs - fromMs;
  if (rangeMs <= 0 || bucketCount <= 0) {
    return [];
  }

  const bucketWidth = rangeMs / bucketCount;
  const times = new Array<number>(bucketCount);
  for (let i = 0; i < bucketCount; i++) {
    times[i] = fromMs + i * bucketWidth + bucketWidth / 2;
  }

  const counts = bucketAgentActivity(items, fromMs, toMs, bucketCount);
  if (counts.length === 0) {
    return [];
  }

  return [
    {
      name: 'Agent activity',
      length: times.length,
      fields: [
        { name: 'Time', type: FieldType.time, values: times, config: {} },
        {
          name: 'Value',
          type: FieldType.number,
          values: counts,
          config: { displayName: 'Agents active' },
        },
      ],
    },
  ];
}

const noThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [{ value: -Infinity, color: 'green' }],
};

const panelOptions = {
  legend: { displayMode: 'hidden' },
  tooltip: { mode: 'single', sort: 'none' },
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
      stacking: { mode: 'none' },
      barAlignment: 0,
      thresholdsStyle: { mode: 'off' },
    },
  },
  overrides: [],
};

export type AgentActivityTimelineProps = {
  items: AgentListItem[];
  timeRange: TimeRange;
  loading: boolean;
};

export function AgentActivityTimeline({ items, timeRange, loading }: AgentActivityTimelineProps) {
  const styles = useStyles2(getStyles);
  const fromMs = timeRange.from.valueOf();
  const toMs = timeRange.to.valueOf();
  const bucketCount = useMemo(() => computeBucketCount(toMs - fromMs), [fromMs, toMs]);

  const dataFrames = useMemo(
    () => buildDataFrames(items, fromMs, toMs, bucketCount),
    [items, fromMs, toMs, bucketCount]
  );

  return (
    <div className={styles.container}>
      <MetricPanel
        title="Agent activity over time"
        description="Based on latest seen timestamps for currently loaded agents."
        pluginId="timeseries"
        data={dataFrames}
        loading={loading}
        height={PANEL_HEIGHT}
        timeRange={timeRange}
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
