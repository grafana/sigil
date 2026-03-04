import React from 'react';
import { cx } from '@emotion/css';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { GenerationCostResult } from '../../generation/types';
import { modelAccentColor, resolveModelKey, extractModelFromLabel, type FlowNode } from './types';
import { getStyles } from './MiniTimeline.styles';

export type MiniTimelineProps = {
  nodes: FlowNode[];
  totalDurationMs: number;
  selectedNodeId: string | null;
  onSelectNode: (node: FlowNode | null) => void;
  generationCosts?: Map<string, GenerationCostResult>;
};

function flattenLeaves(nodes: FlowNode[]): FlowNode[] {
  const result: FlowNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'agent' && node.kind !== 'tool_call') {
      result.push(node);
    }
    if (node.children.length > 0) {
      result.push(...flattenLeaves(node.children));
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

function formatTokens(count: number): string {
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
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

function barColor(node: FlowNode): string | undefined {
  const modelKey = resolveModelKey(node);
  if (modelKey) {
    return modelAccentColor(modelKey);
  }
  switch (node.kind) {
    case 'tool':
      return 'oklch(0.65 0.12 180 / 0.7)';
    case 'embedding':
      return 'oklch(0.65 0.15 300 / 0.7)';
    default:
      return undefined;
  }
}

function buildTooltip(node: FlowNode, costs?: Map<string, GenerationCostResult>): string {
  const model = extractModelFromLabel(node.label);
  const parts: string[] = [model];

  if (node.tokenCount && node.tokenCount > 0) {
    parts.push(`${formatTokens(node.tokenCount)} tokens`);
  }

  const cost = node.generation ? costs?.get(node.generation.generation_id) : undefined;
  if (cost) {
    parts.push(formatCost(cost.breakdown.totalCost));
  }

  parts.push(formatMs(node.durationMs));

  return parts.join(' · ');
}

export default function MiniTimeline({
  nodes,
  totalDurationMs,
  selectedNodeId,
  onSelectNode,
  generationCosts,
}: MiniTimelineProps) {
  const styles = useStyles2(getStyles);

  if (totalDurationMs <= 0) {
    return null;
  }

  const leaves = flattenLeaves(nodes);

  return (
    <div className={styles.container}>
      <div className={styles.label}>Timeline</div>
      <div className={styles.track}>
        {leaves.map((node) => {
          const left = (node.startMs / totalDurationMs) * 100;
          const width = Math.max((node.durationMs / totalDurationMs) * 100, 0.5);
          const color = barColor(node);

          return (
            <Tooltip key={node.id} content={buildTooltip(node, generationCosts)} placement="top">
              <div
                className={cx(styles.bar, node.id === selectedNodeId && styles.barSelected)}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: color,
                }}
                onClick={() => onSelectNode(node.id === selectedNodeId ? null : node)}
                role="button"
                aria-label={`${node.label} ${formatMs(node.durationMs)}`}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className={styles.timeAxis}>
        <span className={styles.timeTick}>0s</span>
        <span className={styles.timeTick}>{formatMs(totalDurationMs)}</span>
      </div>
    </div>
  );
}
