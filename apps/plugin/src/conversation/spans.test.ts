import type { GenerationDetail } from '../generation/types';
import {
  parseOTLPTrace,
  buildSpanTree,
  getSpanType,
  isGenerationSpan,
  isStreamingSpan,
  isToolExecutionSpan,
  isEmbeddingSpan,
  isFrameworkSpan,
  isSigilSDKSpan,
  hasError,
} from './spans';
import type { ConversationSpan, SpanAttributeValue } from './types';

function makeOTLPPayload(spans: Array<Record<string, unknown>>, serviceName = 'test-svc') {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
        },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

function makeOTLPSpan(overrides: Record<string, unknown> = {}) {
  return {
    spanId: 'span-1',
    parentSpanId: '',
    name: 'generateText gpt-4o',
    kind: 3,
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    attributes: [],
    ...overrides,
  };
}

describe('parseOTLPTrace', () => {
  it('parses camelCase OTLP fields', () => {
    const payload = makeOTLPPayload([makeOTLPSpan()]);
    const spans = parseOTLPTrace('trace-1', payload);

    expect(spans).toHaveLength(1);
    expect(spans[0].traceID).toBe('trace-1');
    expect(spans[0].spanID).toBe('span-1');
    expect(spans[0].name).toBe('generateText gpt-4o');
    expect(spans[0].kind).toBe('CLIENT');
    expect(spans[0].serviceName).toBe('test-svc');
    expect(spans[0].startTimeUnixNano).toBe(BigInt('1000000000'));
  });

  it('parses snake_case OTLP fields', () => {
    const payload = {
      resource_spans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
          scope_spans: [
            {
              spans: [
                {
                  span_id: 'span-2',
                  parent_span_id: 'span-1',
                  name: 'child',
                  start_time_unix_nano: '3000000000',
                  end_time_unix_nano: '4000000000',
                },
              ],
            },
          ],
        },
      ],
    };
    const spans = parseOTLPTrace('trace-1', payload);
    expect(spans).toHaveLength(1);
    expect(spans[0].spanID).toBe('span-2');
    expect(spans[0].parentSpanID).toBe('span-1');
  });

  it('handles batches fallback', () => {
    const payload = {
      batches: [
        {
          resource: { attributes: [] },
          instrumentationLibrarySpans: [{ spans: [makeOTLPSpan({ spanId: 'batch-span' })] }],
        },
      ],
    };
    const spans = parseOTLPTrace('t1', payload);
    expect(spans).toHaveLength(1);
    expect(spans[0].spanID).toBe('batch-span');
  });

  it('extracts parentSpanId', () => {
    const payload = makeOTLPPayload([
      makeOTLPSpan({ spanId: 'root', parentSpanId: '' }),
      makeOTLPSpan({ spanId: 'child', parentSpanId: 'root' }),
    ]);
    const spans = parseOTLPTrace('t1', payload);
    expect(spans.find((s) => s.spanID === 'child')?.parentSpanID).toBe('root');
    expect(spans.find((s) => s.spanID === 'root')?.parentSpanID).toBe('');
  });

  it('extracts span attributes', () => {
    const payload = makeOTLPPayload([
      makeOTLPSpan({
        attributes: [
          { key: 'gen_ai.operation.name', value: { stringValue: 'generateText' } },
          { key: 'gen_ai.usage.input_tokens', value: { intValue: '500' } },
        ],
      }),
    ]);
    const spans = parseOTLPTrace('t1', payload);
    expect(spans[0].attributes.get('gen_ai.operation.name')).toEqual({ stringValue: 'generateText' });
    expect(spans[0].attributes.get('gen_ai.usage.input_tokens')).toEqual({ intValue: '500' });
  });

  it('extracts resource attributes', () => {
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'my-svc' } },
              { key: 'deployment.environment', value: { stringValue: 'production' } },
              { key: 'telemetry.sdk.language', value: { stringValue: 'go' } },
            ],
          },
          scopeSpans: [{ spans: [makeOTLPSpan()] }],
        },
      ],
    };
    const spans = parseOTLPTrace('t1', payload);
    expect(spans).toHaveLength(1);
    expect(spans[0].serviceName).toBe('my-svc');
    expect(spans[0].resourceAttributes.get('service.name')).toEqual({ stringValue: 'my-svc' });
    expect(spans[0].resourceAttributes.get('deployment.environment')).toEqual({ stringValue: 'production' });
    expect(spans[0].resourceAttributes.get('telemetry.sdk.language')).toEqual({ stringValue: 'go' });
  });

  it('skips spans without startTimeUnixNano', () => {
    const payload = makeOTLPPayload([makeOTLPSpan({ startTimeUnixNano: undefined, start_time_unix_nano: undefined })]);
    expect(parseOTLPTrace('t1', payload)).toHaveLength(0);
  });

  it('handles nested trace/traces payloads', () => {
    const inner = makeOTLPPayload([makeOTLPSpan({ spanId: 'inner' })]);
    const outer = { trace: inner };
    expect(parseOTLPTrace('t1', outer)).toHaveLength(1);

    const arrayOuter = { traces: [inner] };
    expect(parseOTLPTrace('t1', arrayOuter)).toHaveLength(1);
  });
});

describe('buildSpanTree', () => {
  function makeParsedSpans() {
    const payload = makeOTLPPayload([
      makeOTLPSpan({ spanId: 'root', parentSpanId: '', startTimeUnixNano: '1000', endTimeUnixNano: '5000' }),
      makeOTLPSpan({ spanId: 'child-1', parentSpanId: 'root', startTimeUnixNano: '2000', endTimeUnixNano: '3000' }),
      makeOTLPSpan({ spanId: 'child-2', parentSpanId: 'root', startTimeUnixNano: '3000', endTimeUnixNano: '4000' }),
    ]);
    return parseOTLPTrace('trace-1', payload);
  }

  it('builds parent-child hierarchy', () => {
    const { roots } = buildSpanTree(makeParsedSpans(), []);
    expect(roots).toHaveLength(1);
    expect(roots[0].spanID).toBe('root');
    expect(roots[0].children).toHaveLength(2);
    expect(roots[0].children[0].spanID).toBe('child-1');
    expect(roots[0].children[1].spanID).toBe('child-2');
  });

  it('attaches generations by trace_id + span_id', () => {
    const gen: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      trace_id: 'trace-1',
      span_id: 'child-1',
    };
    const { roots, orphanGenerations } = buildSpanTree(makeParsedSpans(), [gen]);
    expect(roots[0].children[0].generation).not.toBeNull();
    expect(roots[0].children[0].generation!.generation_id).toBe('gen-1');
    expect(orphanGenerations).toHaveLength(0);
  });

  it('matches generations when trace and span IDs use different encodings', () => {
    const traceIDBase64 = 'AQIDBAUGBwgJCgsMDQ4PEA==';
    const traceIDHex = '0102030405060708090a0b0c0d0e0f10';
    const spanIDBase64 = 'AQIDBAUGBwg=';
    const spanIDHex = '0102030405060708';
    const payload = makeOTLPPayload([
      makeOTLPSpan({
        spanId: spanIDBase64,
        parentSpanId: '',
        startTimeUnixNano: '1000',
        endTimeUnixNano: '2000',
      }),
    ]);
    const parsedSpans = parseOTLPTrace(traceIDBase64, payload);
    const generation: GenerationDetail = {
      generation_id: 'gen-hex',
      conversation_id: 'conv-1',
      trace_id: traceIDHex,
      span_id: spanIDHex,
    };

    const { roots, orphanGenerations } = buildSpanTree(parsedSpans, [generation]);

    expect(roots).toHaveLength(1);
    expect(roots[0].traceID).toBe(traceIDHex);
    expect(roots[0].spanID).toBe(spanIDHex);
    expect(roots[0].generation?.generation_id).toBe('gen-hex');
    expect(orphanGenerations).toHaveLength(0);
  });

  it('identifies orphan generations', () => {
    const gen: GenerationDetail = {
      generation_id: 'orphan-gen',
      conversation_id: 'conv-1',
    };
    const { orphanGenerations } = buildSpanTree(makeParsedSpans(), [gen]);
    expect(orphanGenerations).toHaveLength(1);
    expect(orphanGenerations[0].generation_id).toBe('orphan-gen');
  });

  it('merges root spans from multiple traces sorted by time', () => {
    const payload1 = makeOTLPPayload([
      makeOTLPSpan({ spanId: 'root-a', parentSpanId: '', startTimeUnixNano: '5000', endTimeUnixNano: '6000' }),
    ]);
    const payload2 = makeOTLPPayload([
      makeOTLPSpan({ spanId: 'root-b', parentSpanId: '', startTimeUnixNano: '1000', endTimeUnixNano: '2000' }),
    ]);
    const spans = [...parseOTLPTrace('trace-a', payload1), ...parseOTLPTrace('trace-b', payload2)];
    const { roots } = buildSpanTree(spans, []);
    expect(roots).toHaveLength(2);
    expect(roots[0].spanID).toBe('root-b');
    expect(roots[1].spanID).toBe('root-a');
  });
});

describe('span classifiers', () => {
  function spanWithAttrs(entries: Array<[string, SpanAttributeValue]>): ConversationSpan {
    return {
      traceID: 't',
      spanID: 's',
      parentSpanID: '',
      name: 'test',
      kind: 'CLIENT',
      serviceName: 'svc',
      startTimeUnixNano: BigInt(0),
      endTimeUnixNano: BigInt(1),
      durationNano: BigInt(1),
      attributes: new Map(entries),
      resourceAttributes: new Map(),
      generation: null,
      children: [],
    };
  }

  describe('getSpanType', () => {
    it.each([
      { opName: 'generateText', expected: 'generation' },
      { opName: 'streamText', expected: 'generation' },
      { opName: 'execute_tool', expected: 'tool_execution' },
      { opName: 'embeddings', expected: 'embedding' },
      { opName: 'framework_chain', expected: 'framework' },
      { opName: 'framework_retriever', expected: 'framework' },
    ])('returns $expected for $opName', ({ opName, expected }) => {
      expect(getSpanType(spanWithAttrs([['gen_ai.operation.name', { stringValue: opName }]]))).toBe(expected);
    });

    it('returns framework when only framework.name is set', () => {
      expect(getSpanType(spanWithAttrs([['sigil.framework.name', { stringValue: 'langchain' }]]))).toBe('framework');
    });

    it('returns unknown for empty attrs', () => {
      expect(getSpanType(spanWithAttrs([]))).toBe('unknown');
    });
  });

  it('isGenerationSpan', () => {
    expect(isGenerationSpan(spanWithAttrs([['gen_ai.operation.name', { stringValue: 'generateText' }]]))).toBe(true);
    expect(isGenerationSpan(spanWithAttrs([['gen_ai.operation.name', { stringValue: 'execute_tool' }]]))).toBe(false);
  });

  it('isStreamingSpan', () => {
    expect(isStreamingSpan(spanWithAttrs([['gen_ai.operation.name', { stringValue: 'streamText' }]]))).toBe(true);
    expect(isStreamingSpan(spanWithAttrs([['gen_ai.operation.name', { stringValue: 'generateText' }]]))).toBe(false);
  });

  it('isToolExecutionSpan', () => {
    expect(isToolExecutionSpan(spanWithAttrs([['gen_ai.operation.name', { stringValue: 'execute_tool' }]]))).toBe(true);
  });

  it('isEmbeddingSpan', () => {
    expect(isEmbeddingSpan(spanWithAttrs([['gen_ai.operation.name', { stringValue: 'embeddings' }]]))).toBe(true);
  });

  it('isFrameworkSpan', () => {
    expect(isFrameworkSpan(spanWithAttrs([['sigil.framework.name', { stringValue: 'langgraph' }]]))).toBe(true);
    expect(isFrameworkSpan(spanWithAttrs([]))).toBe(false);
  });

  it('isSigilSDKSpan', () => {
    expect(isSigilSDKSpan(spanWithAttrs([['sigil.sdk.name', { stringValue: 'sdk-go' }]]))).toBe(true);
    expect(isSigilSDKSpan(spanWithAttrs([]))).toBe(false);
  });

  it('hasError', () => {
    expect(hasError(spanWithAttrs([['error.type', { stringValue: 'provider_call_error' }]]))).toBe(true);
    expect(hasError(spanWithAttrs([]))).toBe(false);
  });
});
