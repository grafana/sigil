import type { GenerationCostResult, GenerationDetail } from '../generation/types';
import {
  getAllGenerations,
  getAllSpans,
  getTokenSummary,
  getCostSummary,
  getModelUsageBreakdown,
  getErrorSummary,
  getSpanSummary,
  getConversationDuration,
} from './aggregates';
import type { ConversationData, ConversationSpan, SpanAttributeValue } from './types';

function makeSpan(overrides: Partial<ConversationSpan> = {}): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID: 'span-1',
    parentSpanID: '',
    name: 'test',
    kind: 'CLIENT',
    serviceName: 'svc',
    startTimeUnixNano: BigInt(1000),
    endTimeUnixNano: BigInt(5000),
    durationNano: BigInt(4000),
    attributes: new Map<string, SpanAttributeValue>(),
    resourceAttributes: new Map<string, SpanAttributeValue>(),
    generation: null,
    children: [],
    ...overrides,
  };
}

function makeGen(overrides: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    generation_id: 'gen-1',
    conversation_id: 'conv-1',
    model: { provider: 'openai', name: 'gpt-4o' },
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    ...overrides,
  };
}

function makeData(overrides: Partial<ConversationData> = {}): ConversationData {
  return {
    conversationID: 'conv-1',
    generationCount: 0,
    firstGenerationAt: '',
    lastGenerationAt: '',
    ratingSummary: null,
    annotations: [],
    spans: [],
    orphanGenerations: [],
    ...overrides,
  };
}

describe('getAllGenerations', () => {
  it('collects generations from tree and orphans', () => {
    const gen1 = makeGen({ generation_id: 'gen-1' });
    const gen2 = makeGen({ generation_id: 'gen-2' });
    const orphan = makeGen({ generation_id: 'orphan' });

    const data = makeData({
      spans: [makeSpan({ generation: gen1, children: [makeSpan({ spanID: 'child', generation: gen2 })] })],
      orphanGenerations: [orphan],
    });

    const all = getAllGenerations(data);
    expect(all.map((g) => g.generation_id).sort()).toEqual(['gen-1', 'gen-2', 'orphan']);
  });

  it('returns empty for no generations', () => {
    expect(getAllGenerations(makeData())).toHaveLength(0);
  });
});

describe('getAllSpans', () => {
  it('flattens nested spans', () => {
    const data = makeData({
      spans: [
        makeSpan({
          spanID: 'root',
          children: [
            makeSpan({ spanID: 'child-1' }),
            makeSpan({ spanID: 'child-2', children: [makeSpan({ spanID: 'grandchild' })] }),
          ],
        }),
      ],
    });
    expect(getAllSpans(data)).toHaveLength(4);
  });
});

describe('getTokenSummary', () => {
  it('sums tokens across all generations', () => {
    const data = makeData({
      spans: [
        makeSpan({
          generation: makeGen({
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
              cache_read_input_tokens: 20,
              reasoning_tokens: 10,
            },
          }),
        }),
      ],
      orphanGenerations: [
        makeGen({ generation_id: 'o', usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } }),
      ],
    });
    const summary = getTokenSummary(data);
    expect(summary.inputTokens).toBe(300);
    expect(summary.outputTokens).toBe(150);
    expect(summary.cacheReadTokens).toBe(20);
    expect(summary.reasoningTokens).toBe(10);
    expect(summary.totalTokens).toBe(470);
  });

  it('handles generations without usage', () => {
    const data = makeData({
      orphanGenerations: [makeGen({ usage: undefined })],
    });
    const summary = getTokenSummary(data);
    expect(summary.totalTokens).toBe(0);
  });

  it('coerces numeric token strings to numbers', () => {
    const data = makeData({
      orphanGenerations: [
        makeGen({
          usage: {
            input_tokens: '7507575' as unknown as number,
            output_tokens: '3103131' as unknown as number,
            total_tokens: '10610706' as unknown as number,
            cache_read_input_tokens: '150' as unknown as number,
            cache_write_input_tokens: '75' as unknown as number,
          },
        }),
      ],
    });
    const summary = getTokenSummary(data);
    expect(summary.inputTokens).toBe(7507575);
    expect(summary.outputTokens).toBe(3103131);
    expect(summary.cacheReadTokens).toBe(150);
    expect(summary.cacheWriteTokens).toBe(75);
    expect(summary.totalTokens).toBe(10610931);
  });

  it('ignores provider total_tokens when computing the headline total', () => {
    const data = makeData({
      orphanGenerations: [
        makeGen({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 9999,
            cache_read_input_tokens: 25,
            cache_write_input_tokens: 10,
          },
        }),
      ],
    });
    const summary = getTokenSummary(data);
    expect(summary.totalTokens).toBe(185);
  });
});

describe('getCostSummary', () => {
  it('sums cost breakdowns', () => {
    const costs = new Map<string, GenerationCostResult>([
      [
        'gen-1',
        {
          generationID: 'gen-1',
          model: 'gpt-4o',
          provider: 'openai',
          card: {} as GenerationCostResult['card'],
          breakdown: { inputCost: 1.0, outputCost: 2.0, cacheReadCost: 0.5, cacheWriteCost: 0.3, totalCost: 3.8 },
        },
      ],
      [
        'gen-2',
        {
          generationID: 'gen-2',
          model: 'gpt-4o',
          provider: 'openai',
          card: {} as GenerationCostResult['card'],
          breakdown: { inputCost: 0.5, outputCost: 1.0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 1.5 },
        },
      ],
    ]);
    const summary = getCostSummary(costs);
    expect(summary.totalCost).toBeCloseTo(5.3);
    expect(summary.inputCost).toBeCloseTo(1.5);
    expect(summary.outputCost).toBeCloseTo(3.0);
  });

  it('returns zeros for empty map', () => {
    const summary = getCostSummary(new Map());
    expect(summary.totalCost).toBe(0);
  });
});

describe('getModelUsageBreakdown', () => {
  it('groups by provider and model', () => {
    const data = makeData({
      spans: [
        makeSpan({ generation: makeGen({ model: { provider: 'openai', name: 'gpt-4o' } }) }),
        makeSpan({
          spanID: 's2',
          children: [
            makeSpan({
              spanID: 's3',
              generation: makeGen({ generation_id: 'g2', model: { provider: 'anthropic', name: 'claude-3' } }),
            }),
          ],
        }),
      ],
      orphanGenerations: [makeGen({ generation_id: 'g3', model: { provider: 'openai', name: 'gpt-4o' } })],
    });

    const breakdown = getModelUsageBreakdown(data);
    expect(breakdown).toHaveLength(2);

    const openai = breakdown.find((e) => e.provider === 'openai');
    expect(openai?.generationCount).toBe(2);
    expect(openai?.tokens.inputTokens).toBe(200);

    const anthropic = breakdown.find((e) => e.provider === 'anthropic');
    expect(anthropic?.generationCount).toBe(1);
  });
});

describe('getErrorSummary', () => {
  it('counts generations with errors', () => {
    const data = makeData({
      spans: [
        makeSpan({ generation: makeGen({ error: { message: 'rate limit' } }) }),
        makeSpan({ spanID: 's2', generation: makeGen({ generation_id: 'g2', error: null }) }),
      ],
    });
    const summary = getErrorSummary(data);
    expect(summary.totalErrors).toBe(1);
  });

  it('returns zero for no errors', () => {
    expect(getErrorSummary(makeData()).totalErrors).toBe(0);
  });
});

describe('getSpanSummary', () => {
  it('counts spans by type', () => {
    const genAttrs = new Map<string, SpanAttributeValue>([['gen_ai.operation.name', { stringValue: 'generateText' }]]);
    const toolAttrs = new Map<string, SpanAttributeValue>([['gen_ai.operation.name', { stringValue: 'execute_tool' }]]);

    const data = makeData({
      spans: [
        makeSpan({ attributes: genAttrs }),
        makeSpan({ spanID: 's2', attributes: toolAttrs }),
        makeSpan({ spanID: 's3' }),
      ],
    });

    const summary = getSpanSummary(data);
    expect(summary.totalSpans).toBe(3);
    expect(summary.generationSpans).toBe(1);
    expect(summary.toolExecutionSpans).toBe(1);
    expect(summary.otherSpans).toBe(1);
  });
});

describe('getConversationDuration', () => {
  it('returns time between earliest start and latest end', () => {
    const data = makeData({
      spans: [
        makeSpan({ startTimeUnixNano: BigInt(1000), endTimeUnixNano: BigInt(3000) }),
        makeSpan({ spanID: 's2', startTimeUnixNano: BigInt(2000), endTimeUnixNano: BigInt(8000) }),
      ],
    });
    expect(getConversationDuration(data)).toBe(BigInt(7000));
  });

  it('returns 0 for empty data', () => {
    expect(getConversationDuration(makeData())).toBe(BigInt(0));
  });
});
