import { useMemo } from 'react';
import type { ConversationData, ConversationSpan } from '../../conversation/types';
import type { GenerationCostResult, GenerationDetail } from '../../generation/types';
import { getSpanType, getSelectionID, hasError } from '../../conversation/spans';
import { getStringAttr } from '../../conversation/attributes';
import type { FlowNode, FlowNodeKind } from './types';

export type FlowGroupBy = 'none' | 'agent' | 'model' | 'provider';
export type FlowSortBy = 'time' | 'duration' | 'tokens' | 'cost';

export type FlowOptions = {
  groupBy: FlowGroupBy;
  sortBy: FlowSortBy;
};

const ATTR_AGENT_NAME = 'gen_ai.agent.name';
const ATTR_GENERATION_ID = 'sigil.generation.id';
const NS_PER_MS = BigInt(1_000_000);

function spanTypeToKind(spanType: string): FlowNodeKind | null {
  switch (spanType) {
    case 'generation':
      return 'generation';
    case 'tool_execution':
      return 'tool';
    case 'embedding':
      return 'embedding';
    default:
      return null;
  }
}

type GenerationIndex = {
  byTraceSpan: Map<string, GenerationDetail>;
  byGenId: Map<string, GenerationDetail>;
  bySpanId: Map<string, GenerationDetail>;
};

function buildGenerationIndex(generations: GenerationDetail[]): GenerationIndex {
  const byTraceSpan = new Map<string, GenerationDetail>();
  const byGenId = new Map<string, GenerationDetail>();
  const bySpanId = new Map<string, GenerationDetail>();

  for (const gen of generations) {
    if (gen.trace_id && gen.span_id) {
      byTraceSpan.set(`${gen.trace_id}:${gen.span_id}`, gen);
    }
    byGenId.set(gen.generation_id, gen);
    if (gen.span_id) {
      bySpanId.set(gen.span_id, gen);
    }
  }

  return { byTraceSpan, byGenId, bySpanId };
}

function resolveGenerationForSpan(span: ConversationSpan, index: GenerationIndex): GenerationDetail | undefined {
  if (span.generation) {
    return span.generation;
  }
  const traceSpanKey = `${span.traceID}:${span.spanID}`;
  const byTraceSpan = index.byTraceSpan.get(traceSpanKey);
  if (byTraceSpan) {
    return byTraceSpan;
  }
  const genIdAttr = getStringAttr(span.attributes, ATTR_GENERATION_ID);
  if (genIdAttr) {
    const byGenId = index.byGenId.get(genIdAttr);
    if (byGenId) {
      return byGenId;
    }
  }
  const bySpanId = index.bySpanId.get(span.spanID);
  if (bySpanId) {
    return bySpanId;
  }
  return undefined;
}

function extractToolCallChildren(gen: GenerationDetail, parentNodeId: string, parentStartMs: number): FlowNode[] {
  const outputMessages = gen.output ?? [];
  const nodes: FlowNode[] = [];

  const toolResultErrors = new Map<string, boolean>();
  for (const msg of [...(gen.input ?? []), ...outputMessages]) {
    for (const part of msg.parts) {
      if (part.tool_result) {
        toolResultErrors.set(part.tool_result.tool_call_id, part.tool_result.is_error ?? false);
      }
    }
  }

  for (const msg of outputMessages) {
    for (const part of msg.parts) {
      if (part.tool_call) {
        const isError = toolResultErrors.get(part.tool_call.id) ?? false;
        nodes.push({
          id: `toolcall::${gen.generation_id}::${part.tool_call.id}`,
          kind: 'tool_call',
          label: part.tool_call.name,
          durationMs: 0,
          startMs: parentStartMs,
          status: isError ? 'error' : 'success',
          generation: gen,
          toolCallId: part.tool_call.id,
          parentNodeId,
          children: [],
        });
      }
    }
  }

  return nodes;
}

function extractFlowNodes(
  spans: ConversationSpan[],
  conversationStartNs: bigint,
  genIndex: GenerationIndex
): FlowNode[] {
  const result: FlowNode[] = [];

  for (const span of spans) {
    const type = getSpanType(span);
    const kind = spanTypeToKind(type);
    const childNodes = extractFlowNodes(span.children, conversationStartNs, genIndex);

    if (kind !== null) {
      const gen = resolveGenerationForSpan(span, genIndex);
      const totalTokens = gen?.usage?.total_tokens;
      const inputTokens = gen?.usage?.input_tokens ?? 0;
      const outputTokens = gen?.usage?.output_tokens ?? 0;
      const startMs = Number((span.startTimeUnixNano - conversationStartNs) / NS_PER_MS);

      const nodeId = getSelectionID(span);
      const toolCallChildren = kind === 'generation' && gen ? extractToolCallChildren(gen, nodeId, startMs) : [];

      result.push({
        id: nodeId,
        kind,
        label: span.name,
        durationMs: Number(span.durationNano / NS_PER_MS),
        startMs,
        status: hasError(span) || gen?.error?.message ? 'error' : 'success',
        model: gen?.model?.name,
        provider: gen?.model?.provider,
        tokenCount: totalTokens ?? (inputTokens + outputTokens || undefined),
        generation: gen,
        span,
        children: [...childNodes, ...toolCallChildren],
      });
    } else {
      result.push(...childNodes);
    }
  }

  return result;
}

function getAgentName(node: FlowNode): string {
  if (node.generation?.agent_name) {
    return node.generation.agent_name;
  }
  if (node.span) {
    const attrAgent = getStringAttr(node.span.attributes, ATTR_AGENT_NAME);
    if (attrAgent) {
      return attrAgent;
    }
    if (node.span.serviceName) {
      return node.span.serviceName;
    }
  }
  return 'default';
}

function getGroupKey(node: FlowNode, groupBy: FlowGroupBy): string {
  switch (groupBy) {
    case 'agent':
      return getAgentName(node);
    case 'model':
      return node.model ?? 'unknown';
    case 'provider':
      return node.provider ?? 'unknown';
    default:
      return 'default';
  }
}

function groupNodesBy(nodes: FlowNode[], groupBy: FlowGroupBy): FlowNode[] {
  if (groupBy === 'none') {
    return nodes;
  }

  const groupOrder: string[] = [];
  const byGroup = new Map<string, FlowNode[]>();

  for (const node of nodes) {
    const key = getGroupKey(node, groupBy);
    if (!byGroup.has(key)) {
      groupOrder.push(key);
      byGroup.set(key, []);
    }
    byGroup.get(key)!.push(node);
  }

  if (byGroup.size <= 1 && groupOrder[0] === 'default') {
    return nodes;
  }

  return groupOrder.map((name) => {
    const children = byGroup.get(name)!;
    const minStart = Math.min(...children.map((c) => c.startMs));
    const maxEnd = Math.max(...children.map((c) => c.startMs + c.durationMs));
    const hasErrors = children.some((c) => c.status === 'error');

    return {
      id: `agent::${name}`,
      kind: 'agent' as const,
      label: name,
      durationMs: maxEnd - minStart,
      startMs: minStart,
      status: hasErrors ? ('error' as const) : ('success' as const),
      children,
    };
  });
}

function sortNodes(
  nodes: FlowNode[],
  sortBy: FlowSortBy,
  generationCosts?: Map<string, GenerationCostResult>
): FlowNode[] {
  const sorted = [...nodes];
  switch (sortBy) {
    case 'time':
      sorted.sort((a, b) => a.startMs - b.startMs);
      break;
    case 'duration':
      sorted.sort((a, b) => b.durationMs - a.durationMs);
      break;
    case 'tokens':
      sorted.sort((a, b) => (b.tokenCount ?? 0) - (a.tokenCount ?? 0));
      break;
    case 'cost': {
      const getCost = (n: FlowNode) =>
        n.generation ? (generationCosts?.get(n.generation.generation_id)?.breakdown.totalCost ?? 0) : 0;
      sorted.sort((a, b) => getCost(b) - getCost(a));
      break;
    }
  }
  return sorted;
}

function findConversationStartNs(spans: ConversationSpan[]): bigint {
  let min: bigint | null = null;
  for (const span of spans) {
    if (min === null || span.startTimeUnixNano < min) {
      min = span.startTimeUnixNano;
    }
    if (span.children.length > 0) {
      const childMin = findConversationStartNs(span.children);
      if (min === null || childMin < min) {
        min = childMin;
      }
    }
  }
  return min ?? BigInt(0);
}

export type UseConversationFlowResult = {
  flowNodes: FlowNode[];
  totalDurationMs: number;
};

const DEFAULT_OPTIONS: FlowOptions = { groupBy: 'agent', sortBy: 'time' };

export function useConversationFlow(
  data: ConversationData | null,
  allGenerations: GenerationDetail[],
  options?: FlowOptions,
  generationCosts?: Map<string, GenerationCostResult>
): UseConversationFlowResult {
  const { groupBy, sortBy } = options ?? DEFAULT_OPTIONS;

  return useMemo(() => {
    if (!data || data.spans.length === 0) {
      return { flowNodes: [], totalDurationMs: 0 };
    }

    const genIndex = buildGenerationIndex(allGenerations);
    const startNs = findConversationStartNs(data.spans);
    const flatNodes = extractFlowNodes(data.spans, startNs, genIndex);
    const sorted = sortNodes(flatNodes, sortBy, generationCosts);
    const flowNodes = groupNodesBy(sorted, groupBy);

    const allLeaves = flattenFlowNodes(flowNodes);
    const maxEnd = allLeaves.reduce((max, n) => Math.max(max, n.startMs + n.durationMs), 0);

    return { flowNodes, totalDurationMs: maxEnd };
  }, [data, allGenerations, groupBy, sortBy, generationCosts]);
}

function flattenFlowNodes(nodes: FlowNode[]): FlowNode[] {
  const result: FlowNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'agent' && node.kind !== 'tool_call') {
      result.push(node);
    }
    result.push(...flattenFlowNodes(node.children));
  }
  return result;
}
