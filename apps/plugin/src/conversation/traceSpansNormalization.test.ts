import { buildTraceSpans, groupSpansByGenerationID } from './traceSpans';

function makeTracePayload(spanID: string) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
        scopeSpans: [
          {
            spans: [
              {
                spanId: spanID,
                parentSpanId: '',
                name: 'root span',
                startTimeUnixNano: '1000',
                endTimeUnixNano: '2000',
                attributes: [{ key: 'sigil.sdk.name', value: { stringValue: 'sdk-go' } }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('traceSpans normalization', () => {
  it('matches generations when trace and span IDs use different encodings', () => {
    const traceIDBase64 = 'AQIDBAUGBwgJCgsMDQ4PEA==';
    const traceIDHex = '0102030405060708090a0b0c0d0e0f10';
    const spanIDBase64 = 'AQIDBAUGBwg=';
    const spanIDHex = '0102030405060708';

    const spans = buildTraceSpans(traceIDBase64, makeTracePayload(spanIDBase64));
    const grouped = groupSpansByGenerationID(
      [
        {
          generation_id: 'gen-1',
          trace_id: traceIDHex,
          span_id: spanIDHex,
        },
      ],
      spans,
      'all'
    );

    expect(spans).toHaveLength(1);
    expect(spans[0].traceID).toBe(traceIDHex);
    expect(spans[0].spanID).toBe(spanIDHex);
    expect(grouped['gen-1']).toHaveLength(1);
    expect(grouped['gen-1'][0].selectionID).toBe(`${traceIDHex}:${spanIDHex}`);
  });
});
