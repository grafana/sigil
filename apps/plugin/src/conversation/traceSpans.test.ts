import {
  getSelectionID,
  getSpanType,
  isSigilSpan,
  selectSpansForMode,
  flattenSpans,
  spanMatchesFreeText,
  findSpanBySelectionID,
  filterSpansByType,
  filterSpansByText,
  parseOTLPTrace,
  buildSpanTree,
} from './spans';
import type { ConversationSpan, SpanAttributeValue } from './types';

function makeAttrs(entries: Array<[string, SpanAttributeValue]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries);
}

function makeSpan({
  spanID,
  name,
  ...overrides
}: Partial<ConversationSpan> & { spanID: string; name: string }): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID,
    parentSpanID: '',
    name,
    kind: 'CLIENT',
    serviceName: 'svc',
    startTimeUnixNano: BigInt(1),
    endTimeUnixNano: BigInt(2),
    durationNano: BigInt(1),
    attributes: new Map(),
    generation: null,
    children: [],
    ...overrides,
  };
}

describe('getSelectionID', () => {
  it('returns traceID:spanID', () => {
    expect(getSelectionID(makeSpan({ spanID: 'abc', name: 'test', traceID: 'trace-1' }))).toBe('trace-1:abc');
  });
});

describe('isSigilSpan', () => {
  it('returns true for spans with sigil.generation.id', () => {
    const span = makeSpan({
      spanID: 's1',
      name: 'test',
      attributes: makeAttrs([['sigil.generation.id', { stringValue: 'gen-1' }]]),
    });
    expect(isSigilSpan(span)).toBe(true);
  });

  it('returns true for spans with sigil.sdk.name', () => {
    const span = makeSpan({
      spanID: 's1',
      name: 'test',
      attributes: makeAttrs([['sigil.sdk.name', { stringValue: 'sdk-go' }]]),
    });
    expect(isSigilSpan(span)).toBe(true);
  });

  it('returns true for spans with any sigil.* attribute', () => {
    const span = makeSpan({
      spanID: 's1',
      name: 'test',
      attributes: makeAttrs([['sigil.framework.name', { stringValue: 'langchain' }]]),
    });
    expect(isSigilSpan(span)).toBe(true);
  });

  it('returns false for spans without sigil attributes', () => {
    const span = makeSpan({
      spanID: 's1',
      name: 'test',
      attributes: makeAttrs([['http.method', { stringValue: 'GET' }]]),
    });
    expect(isSigilSpan(span)).toBe(false);
  });
});

describe('getSpanType', () => {
  it.each([
    { opName: 'generateText', expected: 'generation' },
    { opName: 'streamText', expected: 'generation' },
    { opName: 'execute_tool', expected: 'tool_execution' },
    { opName: 'embeddings', expected: 'embedding' },
    { opName: 'framework_chain', expected: 'framework' },
  ])('classifies $opName as $expected', ({ opName, expected }) => {
    const span = makeSpan({
      spanID: 's1',
      name: 'test',
      attributes: makeAttrs([['gen_ai.operation.name', { stringValue: opName }]]),
    });
    expect(getSpanType(span)).toBe(expected);
  });

  it('returns unknown for spans without operation name', () => {
    expect(getSpanType(makeSpan({ spanID: 's1', name: 'test' }))).toBe('unknown');
  });
});

describe('selectSpansForMode', () => {
  it('returns all spans in all mode', () => {
    const spans = [makeSpan({ spanID: 's1', name: 'a' }), makeSpan({ spanID: 's2', name: 'b' })];
    expect(selectSpansForMode(spans, 'all')).toHaveLength(2);
  });

  it('filters non-sigil leaf spans in sigil-only mode', () => {
    const sigilChild = makeSpan({
      spanID: 'sigil-child',
      parentSpanID: 'root',
      name: 'generateText',
      attributes: makeAttrs([['gen_ai.operation.name', { stringValue: 'generateText' }]]),
    });
    const otherChild = makeSpan({
      spanID: 'other-child',
      parentSpanID: 'root',
      name: 'db.query',
    });
    const root = makeSpan({
      spanID: 'root',
      name: 'root',
      attributes: makeAttrs([['sigil.generation.id', { stringValue: 'gen-1' }]]),
      children: [sigilChild, otherChild],
    });

    const result = selectSpansForMode([root], 'sigil-only');
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].spanID).toBe('sigil-child');
  });
});

describe('flattenSpans', () => {
  it('flattens tree to list', () => {
    const grandchild = makeSpan({ spanID: 'gc', name: 'grandchild' });
    const child = makeSpan({ spanID: 'c', name: 'child', children: [grandchild] });
    const root = makeSpan({ spanID: 'r', name: 'root', children: [child] });

    expect(flattenSpans([root])).toHaveLength(3);
  });
});

describe('spanMatchesFreeText', () => {
  it('matches span name', () => {
    expect(spanMatchesFreeText(makeSpan({ spanID: 's1', name: 'generateText gpt-4o' }), 'gpt-4o')).toBe(true);
  });

  it('matches attribute values', () => {
    const span = makeSpan({
      spanID: 's1',
      name: 'test',
      attributes: makeAttrs([['gen_ai.request.model', { stringValue: 'claude-3' }]]),
    });
    expect(spanMatchesFreeText(span, 'claude')).toBe(true);
  });

  it('returns true for empty filter', () => {
    expect(spanMatchesFreeText(makeSpan({ spanID: 's1', name: 'test' }), '')).toBe(true);
  });
});

describe('findSpanBySelectionID', () => {
  it('finds span in nested tree', () => {
    const target = makeSpan({ spanID: 'target', name: 'target', traceID: 't1' });
    const root = makeSpan({ spanID: 'root', name: 'root', traceID: 't1', children: [target] });

    expect(findSpanBySelectionID([root], 't1:target')?.name).toBe('target');
  });

  it('returns null when not found', () => {
    expect(findSpanBySelectionID([], 'nope')).toBeNull();
  });
});

describe('filterSpansByType', () => {
  it('keeps only spans of the specified type', () => {
    const genSpan = makeSpan({
      spanID: 's1',
      name: 'gen',
      attributes: makeAttrs([['gen_ai.operation.name', { stringValue: 'generateText' }]]),
    });
    const toolSpan = makeSpan({
      spanID: 's2',
      name: 'tool',
      attributes: makeAttrs([['gen_ai.operation.name', { stringValue: 'execute_tool' }]]),
    });

    const result = filterSpansByType([genSpan, toolSpan], 'generation');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('gen');
  });
});

describe('filterSpansByText', () => {
  it('filters tree by text match', () => {
    const child = makeSpan({ spanID: 'c', parentSpanID: 'r', name: 'search tool' });
    const root = makeSpan({ spanID: 'r', name: 'root', children: [child] });

    const result = filterSpansByText([root], 'search');
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe('search tool');
  });

  it('returns all for empty filter', () => {
    const spans = [makeSpan({ spanID: 's1', name: 'a' })];
    expect(filterSpansByText(spans, '')).toHaveLength(1);
  });
});

describe('parseOTLPTrace + buildSpanTree integration', () => {
  it('parses OTLP trace and builds hierarchical tree with generation attachment', () => {
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  spanId: 'root',
                  parentSpanId: '',
                  name: 'root span',
                  startTimeUnixNano: '1000',
                  endTimeUnixNano: '5000',
                  attributes: [{ key: 'sigil.generation.id', value: { stringValue: 'gen-1' } }],
                },
                {
                  spanId: 'child',
                  parentSpanId: 'root',
                  name: 'child span',
                  startTimeUnixNano: '2000',
                  endTimeUnixNano: '3000',
                },
              ],
            },
          ],
        },
      ],
    };

    const parsedSpans = parseOTLPTrace('trace-1', payload);
    expect(parsedSpans).toHaveLength(2);

    const { roots, orphanGenerations } = buildSpanTree(parsedSpans, [
      { generation_id: 'gen-1', conversation_id: 'conv-1', trace_id: 'trace-1', span_id: 'root' },
    ]);

    expect(roots).toHaveLength(1);
    expect(roots[0].spanID).toBe('root');
    expect(roots[0].generation?.generation_id).toBe('gen-1');
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].spanID).toBe('child');
    expect(orphanGenerations).toHaveLength(0);
  });
});
