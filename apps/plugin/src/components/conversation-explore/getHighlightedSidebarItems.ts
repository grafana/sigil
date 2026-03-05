import type { FlowNode } from './types';
import type { GenerationCostResult } from '../../generation/types';

export type HighlightedSidebarItem = {
  itemId: string;
  label: string;
  kind: FlowNode['kind'];
  node: FlowNode;
  reasons: string[];
  durationMs: number;
  tokenCount: number;
  costUsd: number;
  status: FlowNode['status'];
};

function flattenNodes(nodes: FlowNode[]): FlowNode[] {
  const out: FlowNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children.length > 0) {
      out.push(...flattenNodes(node.children));
    }
  }
  return out;
}

function getGenerationCostUsd(node: FlowNode, generationCosts?: Map<string, GenerationCostResult>): number {
  if (!node.generation) {
    return 0;
  }
  return generationCosts?.get(node.generation.generation_id)?.breakdown.totalCost ?? 0;
}

export function getHighlightedSidebarItems(
  nodes: FlowNode[],
  generationCosts?: Map<string, GenerationCostResult>
): HighlightedSidebarItem[] {
  const all = flattenNodes(nodes).filter((n) => n.kind !== 'agent');
  if (all.length === 0) {
    return [];
  }
  const generationNodes = all.filter((n) => n.kind === 'generation');
  const maxDurationMs = generationNodes.reduce((max, n) => Math.max(max, n.durationMs), 0);
  const maxTokens = generationNodes.reduce((max, n) => Math.max(max, n.tokenCount ?? 0), 0);
  const maxCostUsd = generationNodes.reduce((max, n) => Math.max(max, getGenerationCostUsd(n, generationCosts)), 0);

  const countAtMaxDuration = generationNodes.filter((n) => n.durationMs >= maxDurationMs).length;
  const countAtMaxTokens = generationNodes.filter((n) => (n.tokenCount ?? 0) >= maxTokens).length;
  const countAtMaxCost = generationNodes.filter((n) => getGenerationCostUsd(n, generationCosts) >= maxCostUsd).length;

  const isOutlierDuration = generationNodes.length > 1 && countAtMaxDuration < generationNodes.length;
  const isOutlierTokens = generationNodes.length > 1 && countAtMaxTokens < generationNodes.length;
  const isOutlierCost = generationNodes.length > 1 && countAtMaxCost < generationNodes.length;

  const items: HighlightedSidebarItem[] = [];
  for (const node of all) {
    const reasons: string[] = [];
    const tokenCount = node.tokenCount ?? 0;
    const costUsd = getGenerationCostUsd(node, generationCosts);

    if (node.status === 'error') {
      reasons.push('error');
    }
    if (node.kind === 'generation' && isOutlierDuration && maxDurationMs > 0 && node.durationMs >= maxDurationMs) {
      reasons.push('high_latency');
    }
    if (node.kind === 'generation' && isOutlierTokens && maxTokens > 0 && tokenCount >= maxTokens) {
      reasons.push('high_tokens');
    }
    if (node.kind === 'generation' && isOutlierCost && maxCostUsd > 0 && costUsd >= maxCostUsd) {
      reasons.push('high_cost');
    }
    if (reasons.length === 0) {
      continue;
    }

    items.push({
      itemId: node.id,
      label: node.label,
      kind: node.kind,
      node,
      reasons,
      durationMs: node.durationMs,
      tokenCount,
      costUsd,
      status: node.status,
    });
  }

  items.sort((a, b) => {
    const aError = a.reasons.includes('error') ? 1 : 0;
    const bError = b.reasons.includes('error') ? 1 : 0;
    if (bError !== aError) {
      return bError - aError;
    }
    if (b.reasons.length !== a.reasons.length) {
      return b.reasons.length - a.reasons.length;
    }
    return b.durationMs - a.durationMs;
  });
  return items.slice(0, 10);
}
