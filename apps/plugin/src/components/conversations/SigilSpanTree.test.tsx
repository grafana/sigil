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
  it('starts expanded and renders hierarchy order', () => {
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

    expect(screen.getByRole('button', { name: 'select span root' })).toHaveAttribute('aria-level', '1');
    expect(screen.getByRole('button', { name: 'select span child' })).toHaveAttribute('aria-level', '2');
    expect(screen.getByRole('button', { name: 'select span grandchild' })).toHaveAttribute('aria-level', '3');
  });

  it('collapses and expands all rows from controls', () => {
    const childA = makeSpan({ spanID: 'child-a', parentSpanID: 'root-a', name: 'child-a' });
    const rootA = makeSpan({ spanID: 'root-a', name: 'root-a', children: [childA] });

    render(<SigilSpanTree spans={[rootA]} />);

    expect(screen.getByRole('button', { name: 'select span child-a' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('button', { name: 'select span child-a' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: 'select span child-a' })).toBeInTheDocument();
  });

  it('collapses and expands a parent row from the node toggle', () => {
    const child = makeSpan({ spanID: 'child', parentSpanID: 'root', name: 'child' });
    const root = makeSpan({ spanID: 'root', name: 'root', children: [child] });

    render(<SigilSpanTree spans={[root]} />);

    expect(screen.getByRole('button', { name: 'select span child' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'collapse span root' }));
    expect(screen.queryByRole('button', { name: 'select span child' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'expand span root' }));
    expect(screen.getByRole('button', { name: 'select span child' })).toBeInTheDocument();
  });

  it('calls onSelectSpan when selecting a node', () => {
    const onSelectSpan = jest.fn();
    const root = makeSpan({ spanID: 'root', name: 'root' });

    render(<SigilSpanTree spans={[root]} onSelectSpan={onSelectSpan} />);

    fireEvent.click(screen.getByRole('button', { name: 'select span root' }));
    expect(onSelectSpan).toHaveBeenCalledWith(root);
  });

  it('supports a custom node renderer', () => {
    const root = makeSpan({ spanID: 'root', name: 'root' });

    render(
      <SigilSpanTree
        spans={[root]}
        renderNode={(context) => <span>{`custom:${context.operationName}:${context.durationLabel}`}</span>}
      />
    );

    expect(screen.getByText('custom:root:1ns')).toBeInTheDocument();
  });
});
