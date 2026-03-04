import { buildSigilSpanTreeRows, formatDurationNs } from './adapter';
import type { ConversationSpan, SpanAttributeValue } from '../../../conversation/types';

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
    attributes: new Map<string, SpanAttributeValue>(),
    resourceAttributes: new Map<string, SpanAttributeValue>(),
    generation: null,
    children: [],
    ...overrides,
  };
}

describe('buildSigilSpanTreeRows', () => {
  it('flattens roots and computes ancestry metadata', () => {
    const grandchild = makeSpan({
      spanID: 'grandchild',
      parentSpanID: 'child',
      name: 'grandchild',
      children: [],
    });
    const child = makeSpan({
      spanID: 'child',
      parentSpanID: 'root',
      name: 'child',
      children: [grandchild],
    });
    const root = makeSpan({
      spanID: 'root',
      name: 'root',
      children: [child],
    });

    const { rows } = buildSigilSpanTreeRows([root]);

    expect(rows.map((row) => row.selectionID)).toEqual(['trace-1:root', 'trace-1:child', 'trace-1:grandchild']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
    expect(rows[0].ancestorSelectionIDs).toEqual([]);
    expect(rows[1].ancestorSelectionIDs).toEqual(['trace-1:root']);
    expect(rows[2].ancestorSelectionIDs).toEqual(['trace-1:root', 'trace-1:child']);
  });

  it('computes global trace start and end times', () => {
    const child = makeSpan({
      spanID: 'child',
      parentSpanID: 'root',
      name: 'child',
      startTimeUnixNano: BigInt(500),
      endTimeUnixNano: BigInt(1500),
      durationNano: BigInt(1000),
    });
    const root = makeSpan({
      spanID: 'root',
      name: 'root',
      startTimeUnixNano: BigInt(100),
      endTimeUnixNano: BigInt(2000),
      durationNano: BigInt(1900),
      children: [child],
    });

    const { traceStartNano, traceEndNano } = buildSigilSpanTreeRows([root]);

    expect(traceStartNano).toBe(BigInt(100));
    expect(traceEndNano).toBe(BigInt(2000));
  });

  it('includes timing fields on each row', () => {
    const root = makeSpan({
      spanID: 'root',
      name: 'root',
      startTimeUnixNano: BigInt(100),
      endTimeUnixNano: BigInt(200),
      durationNano: BigInt(100),
    });

    const { rows } = buildSigilSpanTreeRows([root]);

    expect(rows[0].startTimeUnixNano).toBe(BigInt(100));
    expect(rows[0].endTimeUnixNano).toBe(BigInt(200));
    expect(rows[0].durationNano).toBe(BigInt(100));
  });
});

describe('formatDurationNs', () => {
  it('formats units using Jaeger-style compact units', () => {
    expect(formatDurationNs(BigInt(12))).toBe('12ns');
    expect(formatDurationNs(BigInt(25_100))).toBe('25.10us');
    expect(formatDurationNs(BigInt(32_940_000))).toBe('32.94ms');
    expect(formatDurationNs(BigInt(2_500_000_000))).toBe('2.50s');
  });
});
