import { buildSigilSpanTreeRows } from './adapter';
import { collapseAll, collapseOne, expandAll, expandOne, filterVisibleRows } from './collapseState';
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

function makeRows() {
  const grandchild = makeSpan({ spanID: 'grandchild', parentSpanID: 'child', name: 'grandchild' });
  const child = makeSpan({ spanID: 'child', parentSpanID: 'root', name: 'child', children: [grandchild] });
  const sibling = makeSpan({ spanID: 'sibling', parentSpanID: 'root', name: 'sibling' });
  const root = makeSpan({ spanID: 'root', name: 'root', children: [child, sibling] });
  return buildSigilSpanTreeRows([root]).rows;
}

describe('collapseState', () => {
  it('filters descendant rows when a parent is collapsed', () => {
    const rows = makeRows();
    const hidden = new Set<string>(['trace-1:root']);

    const visible = filterVisibleRows(rows, hidden);

    expect(visible.map((row) => row.selectionID)).toEqual(['trace-1:root']);
  });

  it('collapses and expands incrementally', () => {
    const rows = makeRows();

    const collapsedOnce = collapseOne(rows, expandAll());
    expect(Array.from(collapsedOnce)).toEqual(['trace-1:child']);

    const expandedOnce = expandOne(rows, collapsedOnce);
    expect(Array.from(expandedOnce)).toEqual([]);
  });

  it('collapses all parents', () => {
    const rows = makeRows();
    const collapsed = collapseAll(rows);
    expect(Array.from(collapsed).sort()).toEqual(['trace-1:child', 'trace-1:root']);
  });
});
