import React, { useCallback, useMemo, useState } from 'react';
import { cx } from '@emotion/css';
import { Icon, useStyles2 } from '@grafana/ui';
import type { GenerationCostResult } from '../../generation/types';
import { modelAccentColor, extractModelFromLabel, resolveModelKey, type FlowNode, type FlowNodeKind } from './types';
import { getStyles } from './FlowNodeRow.styles';

export type FlowNodeRowProps = {
  node: FlowNode;
  selectedNodeId: string | null;
  onSelectNode: (node: FlowNode | null) => void;
  depth?: number;
  generationIndex?: number;
  generationCosts?: Map<string, GenerationCostResult>;
  siblingHighlights?: SiblingHighlights;
  searchQuery?: string;
};

function formatDuration(ms: number): string {
  if (ms < 1) {
    return '<1ms';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

function formatCostUsd(cost: number): string {
  if (cost < 0.001) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 0.1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

const BADGE_LABELS: Record<FlowNodeKind, string> = {
  agent: '',
  generation: '',
  tool: 'Tool',
  tool_call: 'Call',
  embedding: 'Embed',
};

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const styles = useStyles2(getStyles);
  if (!query) {
    return <>{text}</>;
  }
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.searchHighlight}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function hasContentMatch(node: FlowNode, query: string): boolean {
  if (!query || !node.generation) {
    return false;
  }
  if (node.label.toLowerCase().includes(query)) {
    return false;
  }
  const messages = [...(node.generation.input ?? []), ...(node.generation.output ?? [])];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.text?.toLowerCase().includes(query)) {
        return true;
      }
      if (part.tool_call?.name?.toLowerCase().includes(query)) {
        return true;
      }
      if (part.tool_result?.name?.toLowerCase().includes(query)) {
        return true;
      }
      if (part.tool_result?.content?.toLowerCase().includes(query)) {
        return true;
      }
    }
  }
  return false;
}

function shortenModelName(name: string): string {
  let short = name;
  if (short.startsWith('claude-')) {
    short = short.slice(7);
  }
  const atIdx = short.indexOf('@');
  if (atIdx !== -1) {
    short = short.slice(0, atIdx);
  }
  return short;
}

export function computeGenerationIndices(nodes: FlowNode[]): Array<number | undefined> {
  let counter = 0;
  return nodes.map((node) => (node.kind === 'generation' ? ++counter : undefined));
}

export type SiblingHighlights = {
  maxDurationMs: number;
  maxTokens: number;
  maxCostUsd: number;
};

export function computeSiblingHighlights(
  nodes: FlowNode[],
  costs?: Map<string, GenerationCostResult>
): SiblingHighlights {
  let maxDurationMs = 0;
  let maxTokens = 0;
  let maxCostUsd = 0;

  const gens = nodes.filter((n) => n.kind === 'generation');
  if (gens.length < 2) {
    return { maxDurationMs: Infinity, maxTokens: Infinity, maxCostUsd: Infinity };
  }

  for (const node of gens) {
    if (node.durationMs > maxDurationMs) {
      maxDurationMs = node.durationMs;
    }
    if (node.tokenCount && node.tokenCount > maxTokens) {
      maxTokens = node.tokenCount;
    }
    const cost = node.generation ? costs?.get(node.generation.generation_id) : undefined;
    if (cost && cost.breakdown.totalCost > maxCostUsd) {
      maxCostUsd = cost.breakdown.totalCost;
    }
  }

  return { maxDurationMs, maxTokens, maxCostUsd };
}

export default function FlowNodeRow({
  node,
  selectedNodeId,
  onSelectNode,
  depth = 0,
  generationIndex,
  generationCosts,
  siblingHighlights,
  searchQuery = '',
}: FlowNodeRowProps) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(true);
  const isAgent = node.kind === 'agent';
  const spanChildren = useMemo(() => node.children.filter((c) => c.kind !== 'tool_call'), [node.children]);
  const toolCallChildren = useMemo(() => node.children.filter((c) => c.kind === 'tool_call'), [node.children]);
  const hasChildren = spanChildren.length > 0;
  const isSelected = node.id === selectedNodeId;

  const childGenIndices = useMemo(
    () => (hasChildren ? computeGenerationIndices(spanChildren) : []),
    [hasChildren, spanChildren]
  );

  // Reuse the parent-level highlights so the "max" is always global, not per-group.
  const childHighlights = siblingHighlights;

  const handleClick = useCallback(() => {
    if (isAgent) {
      setExpanded((prev) => !prev);
    } else {
      onSelectNode(isSelected ? null : node);
    }
  }, [isAgent, isSelected, node, onSelectNode]);

  const isGeneration = node.kind === 'generation';
  const modelKey = resolveModelKey(node);
  const displayLabel = isGeneration ? shortenModelName(extractModelFromLabel(node.label)) : node.label;
  const accentColor = modelKey ? modelAccentColor(modelKey) : undefined;
  const costResult = isGeneration && node.generation ? generationCosts?.get(node.generation.generation_id) : undefined;

  const isToolCall = node.kind === 'tool_call';
  const badgeLabel = BADGE_LABELS[node.kind];
  const badgeClass = cx(
    styles.badge,
    {
      tool: styles.badgeTool,
      tool_call: styles.badgeToolCall,
      embedding: styles.badgeEmbedding,
    }[node.kind as string]
  );
  const showContentBadge = searchQuery ? hasContentMatch(node, searchQuery) : false;

  if (isAgent) {
    return (
      <div>
        <div
          className={cx(styles.row, styles.agentRow)}
          onClick={handleClick}
          role="treeitem"
          aria-expanded={expanded}
          aria-label={`agent ${node.label}`}
        >
          <Icon name="angle-right" size="md" className={cx(styles.chevron, expanded && styles.chevronExpanded)} />
          <span className={cx(styles.label, styles.agentLabel)}>
            <HighlightMatch text={node.label} query={searchQuery} />
          </span>
          <span className={styles.duration}>{formatDuration(node.durationMs)}</span>
          {node.status === 'error' && <span className={cx(styles.statusDot, styles.statusError)} />}
        </div>
        {expanded && hasChildren && (
          <div className={styles.childrenContainer}>
            {spanChildren.map((child, i) => (
              <FlowNodeRow
                key={child.id}
                node={child}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                depth={depth + 1}
                generationIndex={childGenIndices[i]}
                generationCosts={generationCosts}
                siblingHighlights={childHighlights}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
        {expanded && toolCallChildren.length > 0 && (
          <div className={styles.childrenContainer}>
            {toolCallChildren.map((child) => (
              <FlowNodeRow
                key={child.id}
                node={child}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                depth={depth + 1}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        className={cx(styles.row, isSelected && styles.rowSelected)}
        onClick={handleClick}
        role="treeitem"
        aria-selected={isSelected}
        aria-label={`${node.kind} ${node.label}`}
      >
        {hasChildren && (
          <Icon
            name="angle-right"
            size="sm"
            className={cx(styles.chevron, expanded && styles.chevronExpanded)}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          />
        )}
        {isGeneration && accentColor && (
          <>
            <span className={styles.generationIndex}>#{generationIndex}</span>
            <span className={styles.modelDot} style={{ background: accentColor }} />
          </>
        )}
        {badgeLabel && <span className={badgeClass}>{badgeLabel}</span>}
        <span className={styles.label}>
          <HighlightMatch text={displayLabel} query={searchQuery} />
        </span>
        {showContentBadge && (
          <span className={styles.contentMatchBadge} title="Match in message content">
            <Icon name="file-alt" size="xs" />
          </span>
        )}
        {!isToolCall && node.tokenCount !== undefined && node.tokenCount > 0 && (
          <span
            className={cx(
              styles.tokenCount,
              isGeneration &&
                siblingHighlights &&
                node.tokenCount >= siblingHighlights.maxTokens &&
                styles.valueHighlight
            )}
          >
            {formatTokens(node.tokenCount)}
          </span>
        )}
        {!isToolCall && costResult && (
          <span
            className={cx(
              styles.costLabel,
              siblingHighlights &&
                costResult.breakdown.totalCost >= siblingHighlights.maxCostUsd &&
                styles.valueHighlight
            )}
          >
            {formatCostUsd(costResult.breakdown.totalCost)}
          </span>
        )}
        {!isToolCall && (
          <span
            className={cx(
              styles.duration,
              isGeneration &&
                siblingHighlights &&
                node.durationMs >= siblingHighlights.maxDurationMs &&
                styles.valueHighlight
            )}
          >
            {formatDuration(node.durationMs)}
          </span>
        )}
        {!isToolCall && (
          <span className={cx(styles.statusDot, node.status === 'error' ? styles.statusError : styles.statusSuccess)} />
        )}
        {isToolCall && node.status === 'error' && <span className={cx(styles.statusDot, styles.statusError)} />}
      </div>
      {expanded && hasChildren && (
        <div className={styles.childrenContainer}>
          {spanChildren.map((child, i) => (
            <FlowNodeRow
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              depth={depth + 1}
              generationIndex={childGenIndices[i]}
              generationCosts={generationCosts}
              siblingHighlights={childHighlights}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
      {expanded && toolCallChildren.length > 0 && (
        <div className={styles.childrenContainer}>
          {toolCallChildren.map((child) => (
            <FlowNodeRow
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              depth={depth + 1}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}
