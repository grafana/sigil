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

    const rows = buildSigilSpanTreeRows([root]);

    expect(rows.map((row) => row.selectionID)).toEqual(['trace-1:root', 'trace-1:child', 'trace-1:grandchild']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
    expect(rows[0].ancestorSelectionIDs).toEqual([]);
    expect(rows[1].ancestorSelectionIDs).toEqual(['trace-1:root']);
    expect(rows[2].ancestorSelectionIDs).toEqual(['trace-1:root', 'trace-1:child']);
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
