import {
  buildTraceSpans,
  classifySigilSpanKind,
  extractSigilSpans,
  groupSigilSpansByGenerationID,
  isSigilSpan,
  selectSpansForMode,
} from './traceSpans';

describe('traceSpans', () => {
  it('extracts only sigil spans and classifies them', () => {
    const spans = buildTraceSpans('trace-1', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'llm-service' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span-generation',
                    name: 'sigil.generation.prompt',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                    attributes: [{ key: 'sigil.generation.id', value: { stringValue: 'gen-1' } }],
                  },
                  {
                    spanId: 'span-tool',
                    name: 'sigil.tool.call',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                    attributes: [{ key: 'sigil.tool.name', value: { stringValue: 'search' } }],
                  },
                  {
                    spanId: 'span-regular',
                    name: 'http.client',
                    startTimeUnixNano: '1772480417578390319',
                    endTimeUnixNano: '1772480417752390319',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const sigilSpans = extractSigilSpans(spans);
    expect(sigilSpans).toHaveLength(2);
    expect(sigilSpans.map((span) => span.spanID).sort()).toEqual(['span-generation', 'span-tool']);
    expect(sigilSpans.find((span) => span.spanID === 'span-generation')?.sigilKind).toBe('generation');
    expect(sigilSpans.find((span) => span.spanID === 'span-tool')?.sigilKind).toBe('tool');
  });

  it('does not treat plain gen_ai operations as Sigil spans without sigil markers', () => {
    const spans = buildTraceSpans('trace-operations', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'llm-service' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span-stream',
                    name: 'streamText gpt-4o-mini',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                    attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'streamText' } }],
                  },
                  {
                    spanId: 'span-embedding',
                    name: 'embeddings text-embedding-3-small',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                    attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'embeddings' } }],
                  },
                  {
                    spanId: 'span-http',
                    name: 'http.client',
                    startTimeUnixNano: '1772480417578390319',
                    endTimeUnixNano: '1772480417752390319',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const byID = new Map(spans.map((span) => [span.spanID, span]));
    expect(isSigilSpan(byID.get('span-stream')!)).toBe(false);
    expect(isSigilSpan(byID.get('span-embedding')!)).toBe(false);
    expect(isSigilSpan(byID.get('span-http')!)).toBe(false);
    expect(classifySigilSpanKind(byID.get('span-stream')!)).toBe('generation');
    expect(classifySigilSpanKind(byID.get('span-embedding')!)).toBe('model');
  });

  it('groups extracted Sigil spans by generation association', () => {
    const spans = buildTraceSpans('trace-association', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'llm-service' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span-gen-1',
                    name: 'generateText gpt-4o-mini',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                    attributes: [
                      { key: 'sigil.generation.id', value: { stringValue: 'gen-1' } },
                      { key: 'gen_ai.operation.name', value: { stringValue: 'generateText' } },
                    ],
                  },
                  {
                    spanId: 'span-tool',
                    name: 'execute_tool weather',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                    attributes: [
                      { key: 'sigil.generation.id', value: { stringValue: 'gen-1' } },
                      { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } },
                    ],
                  },
                  {
                    spanId: 'span-gen-2',
                    name: 'generateText gpt-4o',
                    startTimeUnixNano: '1772480417578390319',
                    endTimeUnixNano: '1772480417752390319',
                    attributes: [
                      { key: 'sigil.generation.id', value: { stringValue: 'gen-2' } },
                      { key: 'gen_ai.operation.name', value: { stringValue: 'generateText' } },
                    ],
                  },
                  {
                    spanId: 'span-non-sigil',
                    name: 'db.query',
                    startTimeUnixNano: '1772480417578390320',
                    endTimeUnixNano: '1772480417752390320',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const grouped = groupSigilSpansByGenerationID(
      [
        { generation_id: 'gen-1', trace_id: 'trace-association' },
        { generation_id: 'gen-2', trace_id: 'trace-association' },
      ],
      spans
    );

    expect(grouped['gen-1'].map((span) => span.spanID).sort()).toEqual(['span-gen-1', 'span-tool']);
    expect(grouped['gen-2'].map((span) => span.spanID).sort()).toEqual(['span-gen-2']);
  });

  it('selects Sigil-only vs all modes through utility selection', () => {
    const spans = buildTraceSpans('trace-selection', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'llm-service' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'span-sigil',
                    name: 'streamText gpt-4o-mini',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                    attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'streamText' } }],
                  },
                  {
                    spanId: 'span-http',
                    name: 'http.client',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const sigilOnly = selectSpansForMode(spans, 'sigil-only');
    const all = selectSpansForMode(spans, 'all');

    expect(sigilOnly.map((span) => span.spanID).sort()).toEqual(['span-http', 'span-sigil']);
    expect(all.map((span) => span.spanID).sort()).toEqual(['span-http', 'span-sigil']);
  });

  it('keeps filtered hierarchy for Sigil-only spans', () => {
    const spans = buildTraceSpans('trace-hierarchy', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'llm-service' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'root-sigil',
                    name: 'sigil.generation.prompt',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                    attributes: [{ key: 'sigil.generation.id', value: { stringValue: 'gen-1' } }],
                  },
                  {
                    spanId: 'middle-other',
                    parentSpanId: 'root-sigil',
                    name: 'db.query',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                  },
                  {
                    spanId: 'leaf-sigil',
                    parentSpanId: 'middle-other',
                    name: 'sigil.tool.call',
                    startTimeUnixNano: '1772480417578390319',
                    endTimeUnixNano: '1772480417752390319',
                    attributes: [{ key: 'sigil.tool.name', value: { stringValue: 'search' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const sigilOnly = selectSpansForMode(spans, 'sigil-only');
    const byID = new Map(sigilOnly.map((span) => [span.spanID, span]));

    expect(byID.get('root-sigil')?.parentSpanID).toBe('');
    expect(byID.get('leaf-sigil')?.parentSpanID).toBe('root-sigil');
  });

  it('keeps root OTHER spans visible in filtered mode', () => {
    const spans = buildTraceSpans('trace-root-other', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: 'root-other',
                    name: 'http.server',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                  },
                  {
                    spanId: 'child-ai',
                    parentSpanId: 'root-other',
                    name: 'streamText gpt-4o-mini',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                    attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'streamText' } }],
                  },
                  {
                    spanId: 'child-other',
                    parentSpanId: 'root-other',
                    name: 'db.query',
                    startTimeUnixNano: '1772480417578390319',
                    endTimeUnixNano: '1772480417752390319',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const sigilOnly = selectSpansForMode(spans, 'sigil-only');
    const byID = new Map(sigilOnly.map((span) => [span.spanID, span]));

    expect(byID.get('root-other')?.sigilKind).toBe('other');
    expect(byID.get('child-ai')?.parentSpanID).toBe('root-other');
    expect(byID.has('child-other')).toBe(false);
  });

  it('parses parentSpanID field for hierarchy links', () => {
    const spans = buildTraceSpans('trace-parent-id', {
      trace: {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanID: 'root',
                    name: 'sigil.generation.prompt',
                    startTimeUnixNano: '1772480417578390317',
                    endTimeUnixNano: '1772480417752390317',
                    attributes: [{ key: 'sigil.generation.id', value: { stringValue: 'gen-1' } }],
                  },
                  {
                    spanID: 'child',
                    parentSpanID: 'root',
                    name: 'sigil.tool.call',
                    startTimeUnixNano: '1772480417578390318',
                    endTimeUnixNano: '1772480417752390318',
                    attributes: [{ key: 'sigil.tool.name', value: { stringValue: 'search' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const all = selectSpansForMode(spans, 'all');
    const byID = new Map(all.map((span) => [span.spanID, span]));
    expect(byID.get('child')?.parentSpanID).toBe('root');
  });
});
