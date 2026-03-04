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
    startTimeUnixNano: BigInt(1_000_000),
    endTimeUnixNano: BigInt(2_000_000),
    durationNano: BigInt(1_000_000),
    attributes: new Map<string, SpanAttributeValue>(),
    resourceAttributes: new Map<string, SpanAttributeValue>(),
    generation: null,
    children: [],
    ...overrides,
  };
}

describe('SigilSpanTree', () => {
  it('starts expanded and renders hierarchy order', () => {
    const grandchild = makeSpan({
      spanID: 'grandchild',
      parentSpanID: 'child-1',
      name: 'grandchild',
      startTimeUnixNano: BigInt(4_000_000),
      endTimeUnixNano: BigInt(5_000_000),
      durationNano: BigInt(1_000_000),
    });
    const child1 = makeSpan({
      spanID: 'child-1',
      parentSpanID: 'root',
      name: 'first child',
      startTimeUnixNano: BigInt(2_000_000),
      endTimeUnixNano: BigInt(6_000_000),
      durationNano: BigInt(4_000_000),
      children: [grandchild],
    });
    const child2 = makeSpan({
      spanID: 'child-2',
      parentSpanID: 'root',
      name: 'second child',
      startTimeUnixNano: BigInt(3_000_000),
      endTimeUnixNano: BigInt(4_000_000),
      durationNano: BigInt(1_000_000),
    });
    const root = makeSpan({
      spanID: 'root',
      name: 'root',
      startTimeUnixNano: BigInt(1_000_000),
      endTimeUnixNano: BigInt(7_000_000),
      durationNano: BigInt(6_000_000),
      children: [child1, child2],
    });

    render(<SigilSpanTree spans={[root]} />);

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

  it('collapses and expands all rows from controls', () => {
    const childA = makeSpan({
      spanID: 'child-a',
      parentSpanID: 'root-a',
      name: 'child-a',
      startTimeUnixNano: BigInt(2_000_000),
      endTimeUnixNano: BigInt(3_000_000),
      durationNano: BigInt(1_000_000),
    });
    const rootA = makeSpan({
      spanID: 'root-a',
      name: 'root-a',
      startTimeUnixNano: BigInt(1_000_000),
      endTimeUnixNano: BigInt(4_000_000),
      durationNano: BigInt(3_000_000),
      children: [childA],
    });

    render(<SigilSpanTree spans={[rootA]} />);

    expect(screen.getByRole('button', { name: 'select span child-a' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('button', { name: 'select span child-a' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: 'select span child-a' })).toBeInTheDocument();
  });

  it('calls onSelectSpan when selecting a node', () => {
    const onSelectSpan = jest.fn();
    const root = makeSpan({ spanID: 'root', name: 'root' });

    render(<SigilSpanTree spans={[root]} onSelectSpan={onSelectSpan} />);

    fireEvent.click(screen.getByRole('button', { name: 'select span root' }));
    expect(onSelectSpan).toHaveBeenCalledWith(root);
  });

  it('renders the timeline header with ticks', () => {
    const root = makeSpan({
      spanID: 'root',
      name: 'root',
      startTimeUnixNano: BigInt(0),
      endTimeUnixNano: BigInt(1_000_000_000),
      durationNano: BigInt(1_000_000_000),
    });

    render(<SigilSpanTree spans={[root]} />);

    expect(screen.getByText('Service & Operation')).toBeInTheDocument();
  });

  it('shows empty state when no spans', () => {
    render(<SigilSpanTree spans={[]} />);
    expect(screen.getByText('No spans to display.')).toBeInTheDocument();
  });
});
