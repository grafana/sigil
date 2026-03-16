import React, { useMemo, useState } from 'react';
import { cx } from '@emotion/css';
import { MutableDataFrame, FieldType, dateTime, type TimeRange } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';
import type { GenerationCostResult, GenerationDetail } from '../../generation/types';
import type { FlowNode } from './types';
import { MetricPanel } from '../dashboard/MetricPanel';
import { getStyles } from './ConversationMetricsStrip.styles';
import { toNum } from '../../conversation/aggregates';

export type ConversationMetricsStripProps = {
  allGenerations: GenerationDetail[];
  flowNodes: FlowNode[];
  generationCosts?: Map<string, GenerationCostResult>;
  currentGenerationId?: string | null;
  onNavigateToGeneration?: (generationId: string) => void;
};

type Metric = 'latency' | 'cost';

type DataPoint = {
  model: string;
  durationMs: number;
  cost: number;
  tokens: number;
  createdAt: number;
};

function collectGenerationDurations(nodes: FlowNode[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const node of nodes) {
    if (node.generation) {
      result.set(node.generation.generation_id, node.durationMs);
    }
    if (node.children.length > 0) {
      for (const [id, dur] of collectGenerationDurations(node.children)) {
        result.set(id, dur);
      }
    }
  }
  return result;
}

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost < 0.001) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 0.1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

const CHART_HEIGHT = 180;

const timeseriesOptions = {
  legend: { displayMode: 'hidden' as const },
  tooltip: { mode: 'single' as const },
};

export default function ConversationMetricsStrip({
  allGenerations,
  flowNodes,
  generationCosts,
}: ConversationMetricsStripProps) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(false);
  const [metric, setMetric] = useState<Metric>('latency');

  const durationMap = useMemo(() => collectGenerationDurations(flowNodes), [flowNodes]);

  const dataPoints = useMemo<DataPoint[]>(() => {
    const sorted = [...allGenerations].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    });

    return sorted.map((gen) => {
      const cost = generationCosts?.get(gen.generation_id);
      const inputTokens =
        toNum(gen.usage?.input_tokens) +
        toNum(gen.usage?.cache_read_input_tokens) +
        toNum(gen.usage?.cache_write_input_tokens);
      const outputTokens = toNum(gen.usage?.output_tokens);
      const totalTokens = toNum(gen.usage?.total_tokens) || inputTokens + outputTokens;
      return {
        model: gen.model?.name ?? 'unknown',
        durationMs: durationMap.get(gen.generation_id) ?? 0,
        cost: cost?.breakdown.totalCost ?? 0,
        tokens: totalTokens,
        createdAt: gen.created_at ? new Date(gen.created_at).getTime() : 0,
      };
    });
  }, [allGenerations, durationMap, generationCosts]);

  const { frames, timeRange } = useMemo(() => {
    const times = dataPoints.map((dp) => dp.createdAt);
    const values = dataPoints.map((dp) => (metric === 'latency' ? dp.durationMs / 1000 : dp.cost));

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const padding = Math.max((maxTime - minTime) * 0.05, 1000);

    const frame = new MutableDataFrame({
      name: metric === 'latency' ? 'Latency' : 'Cost',
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        {
          name: metric === 'latency' ? 'Latency' : 'Cost',
          type: FieldType.number,
          values,
          config: {
            unit: metric === 'latency' ? 's' : 'currencyUSD',
            displayName: metric === 'latency' ? 'Latency' : 'Cost',
          },
        },
      ],
    });

    const range: TimeRange = {
      from: dateTime(minTime - padding),
      to: dateTime(maxTime + padding),
      raw: { from: dateTime(minTime - padding).toISOString(), to: dateTime(maxTime + padding).toISOString() },
    };

    return { frames: [frame], timeRange: range };
  }, [dataPoints, metric]);

  if (dataPoints.length < 2) {
    return null;
  }

  const maxDuration = Math.max(...dataPoints.map((dp) => dp.durationMs));
  const totalCost = dataPoints.reduce((sum, dp) => sum + dp.cost, 0);
  const hasCost = totalCost > 0;

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setExpanded((p) => !p)}>
        <Icon name="angle-right" size="sm" className={cx(styles.chevron, expanded && styles.chevronExpanded)} />
        <span className={styles.headerLabel}>Metrics</span>
        <span className={styles.headerSummary}>
          {dataPoints.length} calls · peak {formatMs(maxDuration)}
          {hasCost && ` · ${formatCost(totalCost)} total`}
        </span>
      </div>
      {expanded && (
        <div className={styles.body}>
          <div className={styles.tabs}>
            <button
              className={cx(styles.tab, metric === 'latency' && styles.tabActive)}
              onClick={() => setMetric('latency')}
            >
              Latency
            </button>
            {hasCost && (
              <button
                className={cx(styles.tab, metric === 'cost' && styles.tabActive)}
                onClick={() => setMetric('cost')}
              >
                Cost
              </button>
            )}
          </div>
          <MetricPanel
            title=""
            pluginId="timeseries"
            data={frames}
            loading={false}
            height={CHART_HEIGHT}
            timeRange={timeRange}
            options={timeseriesOptions}
            fieldConfig={{
              defaults: {
                unit: metric === 'latency' ? 's' : 'currencyUSD',
                custom: {
                  drawStyle: 'line',
                  lineInterpolation: 'smooth',
                  lineWidth: 2,
                  fillOpacity: 10,
                  pointSize: 6,
                  showPoints: 'always',
                  spanNulls: false,
                },
              },
              overrides: [],
            }}
          />
        </div>
      )}
    </div>
  );
}
