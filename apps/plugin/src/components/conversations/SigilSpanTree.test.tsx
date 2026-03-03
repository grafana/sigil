import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SigilSpanTree from './SigilSpanTree';
import type { ConversationSpan, SpanAttributeValue } from '../../conversation/types';

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

describe('SigilSpanTree', () => {
  it('starts with roots collapsed and expands in hierarchy order', () => {
    const grandchild = makeSpan({
      spanID: 'grandchild',
      parentSpanID: 'child-1',
      name: 'grandchild',
      startTimeUnixNano: BigInt(4),
    });
    const child1 = makeSpan({
      spanID: 'child-1',
      parentSpanID: 'root',
      name: 'first child',
      startTimeUnixNano: BigInt(2),
      children: [grandchild],
    });
    const child2 = makeSpan({
      spanID: 'child-2',
      parentSpanID: 'root',
      name: 'second child',
      startTimeUnixNano: BigInt(3),
    });
    const root = makeSpan({ spanID: 'root', name: 'root', startTimeUnixNano: BigInt(1), children: [child1, child2] });

    render(<SigilSpanTree spans={[root]} />);

    expect(screen.getByRole('button', { name: 'select span root' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select span first child' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'expand span root' }));
    fireEvent.click(screen.getByRole('button', { name: 'expand span first child' }));

    const buttons = screen.getAllByRole('button');
    const selectLabels = buttons
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter((label) => label.startsWith('select span '));
    expect(selectLabels).toEqual([
      'select span root',
      'select span first child',
      'select span grandchild',
      'select span second child',
    ]);
  });

  it('sets aria-level based on hierarchy depth', () => {
    const grandchild = makeSpan({ spanID: 'grandchild', parentSpanID: 'child', name: 'grandchild' });
    const child = makeSpan({ spanID: 'child', parentSpanID: 'root', name: 'child', children: [grandchild] });
    const root = makeSpan({ spanID: 'root', name: 'root', children: [child] });

    render(<SigilSpanTree spans={[root]} />);

    fireEvent.click(screen.getByRole('button', { name: 'expand span root' }));
    fireEvent.click(screen.getByRole('button', { name: 'expand span child' }));

    expect(screen.getByRole('button', { name: 'select span root' })).toHaveAttribute('aria-level', '1');
    expect(screen.getByRole('button', { name: 'select span child' })).toHaveAttribute('aria-level', '2');
    expect(screen.getByRole('button', { name: 'select span grandchild' })).toHaveAttribute('aria-level', '3');
  });

  it('collapses root items by default', () => {
    const childA = makeSpan({
      spanID: 'child-a',
      parentSpanID: 'root-a',
      name: 'child-a',
      startTimeUnixNano: BigInt(3),
    });
    const rootA = makeSpan({ spanID: 'root-a', name: 'root-a', startTimeUnixNano: BigInt(1), children: [childA] });
    const rootB = makeSpan({ spanID: 'root-b', name: 'root-b', startTimeUnixNano: BigInt(2) });

    render(<SigilSpanTree spans={[rootA, rootB]} />);

    expect(screen.getByRole('button', { name: 'select span root-a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'select span root-b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select span child-a' })).not.toBeInTheDocument();
  });

  it('expands a root item when selected', () => {
    const child = makeSpan({ spanID: 'child', parentSpanID: 'root', name: 'child', startTimeUnixNano: BigInt(2) });
    const root = makeSpan({ spanID: 'root', name: 'root', startTimeUnixNano: BigInt(1), children: [child] });

    render(<SigilSpanTree spans={[root]} />);

    expect(screen.queryByRole('button', { name: 'select span child' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'select span root' }));
    expect(screen.getByRole('button', { name: 'select span child' })).toBeInTheDocument();
  });

  it('nests children within the same trace', () => {
    const childTrace2 = makeSpan({
      traceID: 'trace-2',
      spanID: 'child',
      parentSpanID: 'root',
      name: 'child-trace-2',
      startTimeUnixNano: BigInt(3),
    });
    const rootTrace1 = makeSpan({
      traceID: 'trace-1',
      spanID: 'root',
      name: 'root-trace-1',
      startTimeUnixNano: BigInt(1),
    });
    const rootTrace2 = makeSpan({
      traceID: 'trace-2',
      spanID: 'root',
      name: 'root-trace-2',
      startTimeUnixNano: BigInt(2),
      children: [childTrace2],
    });

    render(<SigilSpanTree spans={[rootTrace1, rootTrace2]} />);

    expect(screen.queryByRole('button', { name: 'expand span root-trace-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'expand span root-trace-2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select span child-trace-2' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'expand span root-trace-2' }));

    expect(screen.getByRole('button', { name: 'select span child-trace-2' })).toBeInTheDocument();
  });
});
