import React, { useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import {
  dateTime,
  FieldType,
  ThresholdsMode,
  type AbsoluteTimeRange,
  type DataFrame,
  type FieldConfigSource,
  type GrafanaTheme2,
  type TimeRange,
} from '@grafana/data';
import type { ConversationSearchResult } from '../../conversation/types';
import { MetricPanel } from '../dashboard/MetricPanel';

export type BucketResult = {
  times: number[];
  counts: number[];
};

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

export function bucketConversations(
  conversations: ConversationSearchResult[],
  fromMs: number,
  toMs: number,
  bucketCount: number
): BucketResult {
  const rangeMs = toMs - fromMs;
  if (rangeMs <= 0 || bucketCount <= 0) {
    return { times: [], counts: [] };
  }

  const bucketWidth = rangeMs / bucketCount;
  const times = new Array<number>(bucketCount);
  const counts = new Array<number>(bucketCount).fill(0);

  for (let i = 0; i < bucketCount; i++) {
    times[i] = fromMs + i * bucketWidth + bucketWidth / 2;
  }

  for (const conv of conversations) {
    const ts = Date.parse(conv.last_generation_at);
    if (!Number.isFinite(ts)) {
      continue;
    }
    let idx = Math.floor((ts - fromMs) / bucketWidth);
    if (idx < 0) {
      idx = 0;
    }
    if (idx >= bucketCount) {
      idx = bucketCount - 1;
    }
    counts[idx]++;
  }

  return { times, counts };
}

function buildDataFrames(buckets: BucketResult): DataFrame[] {
  if (buckets.times.length === 0) {
    return [];
  }

  const len = buckets.times.length;

  return [
    {
      name: 'Conversations',
      length: len,
      fields: [
        { name: 'Time', type: FieldType.time, values: buckets.times, config: {} },
        {
          name: 'Value',
          type: FieldType.number,
          values: buckets.counts,
          config: { displayName: 'Conversations' },
        },
      ],
    },
  ];
}

const HISTOGRAM_HEIGHT = 200;

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
    color: { mode: 'fixed', fixedColor: '#6C63FF' },
    custom: {
      drawStyle: 'bars',
      fillOpacity: 65,
      lineWidth: 0,
      gradientMode: 'scheme',
      stacking: { mode: 'none' },
      barAlignment: 0,
      thresholdsStyle: { mode: 'off' },
    },
  },
  overrides: [],
};

export type ConversationTimelineHistogramProps = {
  conversations: ConversationSearchResult[];
  timeRange: TimeRange;
  loading: boolean;
  onTimeRangeChange?: (timeRange: TimeRange) => void;
};

export function ConversationTimelineHistogram({
  conversations,
  timeRange,
  loading,
  onTimeRangeChange,
}: ConversationTimelineHistogramProps) {
  const styles = useStyles2(getStyles);

  const fromMs = timeRange.from.valueOf();
  const toMs = timeRange.to.valueOf();
  const bucketCount = useMemo(() => computeBucketCount(toMs - fromMs), [fromMs, toMs]);

  const dataFrames = useMemo(() => {
    const buckets = bucketConversations(conversations, fromMs, toMs, bucketCount);
    return buildDataFrames(buckets);
  }, [conversations, fromMs, toMs, bucketCount]);

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
        title="Conversation activity"
        pluginId="timeseries"
        data={dataFrames}
        loading={loading}
        height={HISTOGRAM_HEIGHT}
        timeRange={timeRange}
        onChangeTimeRange={onTimeRangeChange ? handlePanelTimeRangeChange : undefined}
        options={panelOptions}
        fieldConfig={fieldConfig}
      />
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      width: '100%',
      // hacky way to show barchart which i don't know why it works but it does
      label: 'conversationTimelineHistogram-container',
      '[data-testid="data-testid panel content"] > div > div:nth-child(2)': {
        height: '1px',
      },
    }),
  };
}
