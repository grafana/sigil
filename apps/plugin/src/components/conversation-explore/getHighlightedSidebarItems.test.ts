import { getHighlightedSidebarItems } from './getHighlightedSidebarItems';
import type { FlowNode } from './types';
import type { GenerationCostResult } from '../../generation/types';

function makeGenNode(id: string, overrides: Partial<FlowNode> & { durationMs: number; tokenCount?: number }): FlowNode {
  const { durationMs, tokenCount, ...rest } = overrides;
  return {
    id,
    kind: 'generation',
    label: `gen-${id}`,
    startMs: 0,
    status: 'success',
    children: [],
    durationMs,
    tokenCount,
    generation: { generation_id: id, conversation_id: id },
    ...rest,
  };
}

function makeCost(id: string, totalCost: number): [string, GenerationCostResult] {
  return [
    id,
    {
      generationID: id,
      model: 'gpt-4o',
      provider: 'openai',
      card: {} as GenerationCostResult['card'],
      breakdown: {
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        totalCost,
      },
    },
  ];
}

describe('getHighlightedSidebarItems', () => {
  it('does not flag single generation as high_latency, high_tokens, or high_cost', () => {
    const nodes: FlowNode[] = [makeGenNode('gen-1', { durationMs: 5000, tokenCount: 1000 })];
    const costs = new Map<string, GenerationCostResult>([makeCost('gen-1', 0.05)]);
    const items = getHighlightedSidebarItems(nodes, costs);
    expect(items).toHaveLength(0);
  });

  it('does not flag all-equal generations as high_*', () => {
    const nodes: FlowNode[] = [
      makeGenNode('gen-1', { durationMs: 100, tokenCount: 50 }),
      makeGenNode('gen-2', { durationMs: 100, tokenCount: 50 }),
    ];
    const costs = new Map<string, GenerationCostResult>([makeCost('gen-1', 0.01), makeCost('gen-2', 0.01)]);
    const items = getHighlightedSidebarItems(nodes, costs);
    expect(items).toHaveLength(0);
  });

  it('flags only the max generation as high_latency when there are outliers', () => {
    const nodes: FlowNode[] = [
      makeGenNode('gen-1', { durationMs: 5000, tokenCount: 100 }),
      makeGenNode('gen-2', { durationMs: 100, tokenCount: 100 }),
    ];
    const items = getHighlightedSidebarItems(nodes);
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('gen-1');
    expect(items[0].reasons).toContain('high_latency');
  });

  it('flags only the max generation as high_tokens when there are outliers', () => {
    const nodes: FlowNode[] = [
      makeGenNode('gen-1', { durationMs: 100, tokenCount: 1000 }),
      makeGenNode('gen-2', { durationMs: 100, tokenCount: 50 }),
    ];
    const items = getHighlightedSidebarItems(nodes);
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('gen-1');
    expect(items[0].reasons).toContain('high_tokens');
  });

  it('flags only the max generation as high_cost when there are outliers', () => {
    const nodes: FlowNode[] = [
      makeGenNode('gen-1', { durationMs: 100, tokenCount: 100 }),
      makeGenNode('gen-2', { durationMs: 100, tokenCount: 100 }),
    ];
    const costs = new Map<string, GenerationCostResult>([makeCost('gen-1', 0.1), makeCost('gen-2', 0.01)]);
    const items = getHighlightedSidebarItems(nodes, costs);
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('gen-1');
    expect(items[0].reasons).toContain('high_cost');
  });

  it('always flags error nodes regardless of count', () => {
    const nodes: FlowNode[] = [makeGenNode('gen-1', { durationMs: 100, tokenCount: 50, status: 'error' })];
    const items = getHighlightedSidebarItems(nodes);
    expect(items).toHaveLength(1);
    expect(items[0].reasons).toEqual(['error']);
  });
});
