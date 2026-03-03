import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SigilSpanTree from './SigilSpanTree';
import type { SigilSpan } from '../../conversation/traceSpans';

function makeSpan({
  selectionID,
  spanID,
  name,
  ...rest
}: Partial<SigilSpan> & Pick<SigilSpan, 'selectionID' | 'spanID' | 'name'>): SigilSpan {
  return {
    selectionID,
    spanID,
    name,
    traceID: 'trace-1',
    parentSpanID: '',
    serviceName: 'svc',
    startNs: BigInt(1),
    endNs: BigInt(2),
    durationNs: BigInt(1),
    attributes: {},
    sigilKind: 'generation',
    ...rest,
  };
}

describe('SigilSpanTree', () => {
  it('starts with roots collapsed and expands in hierarchy order', () => {
    const spans: SigilSpan[] = [
      makeSpan({
        selectionID: 'child-2',
        spanID: 'child-2',
        parentSpanID: 'root',
        name: 'second child',
        startNs: BigInt(3),
      }),
      makeSpan({ selectionID: 'root', spanID: 'root', name: 'root', startNs: BigInt(1) }),
      makeSpan({
        selectionID: 'child-1',
        spanID: 'child-1',
        parentSpanID: 'root',
        name: 'first child',
        startNs: BigInt(2),
      }),
      makeSpan({
        selectionID: 'grandchild',
        spanID: 'grandchild',
        parentSpanID: 'child-1',
        name: 'grandchild',
        startNs: BigInt(4),
      }),
    ];

    render(<SigilSpanTree spans={spans} />);

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
    const spans: SigilSpan[] = [
      makeSpan({ selectionID: 'root', spanID: 'root', name: 'root' }),
      makeSpan({ selectionID: 'child', spanID: 'child', parentSpanID: 'root', name: 'child' }),
      makeSpan({ selectionID: 'grandchild', spanID: 'grandchild', parentSpanID: 'child', name: 'grandchild' }),
    ];

    render(<SigilSpanTree spans={spans} />);

    fireEvent.click(screen.getByRole('button', { name: 'expand span root' }));
    fireEvent.click(screen.getByRole('button', { name: 'expand span child' }));

    expect(screen.getByRole('button', { name: 'select span root' })).toHaveAttribute('aria-level', '1');
    expect(screen.getByRole('button', { name: 'select span child' })).toHaveAttribute('aria-level', '2');
    expect(screen.getByRole('button', { name: 'select span grandchild' })).toHaveAttribute('aria-level', '3');
  });

  it('collapses root items by default', () => {
    const spans: SigilSpan[] = [
      makeSpan({ selectionID: 'root-a', spanID: 'root-a', name: 'root-a', startNs: BigInt(1) }),
      makeSpan({ selectionID: 'root-b', spanID: 'root-b', name: 'root-b', startNs: BigInt(2) }),
      makeSpan({
        selectionID: 'child-a',
        spanID: 'child-a',
        parentSpanID: 'root-a',
        name: 'child-a',
        startNs: BigInt(3),
      }),
    ];

    render(<SigilSpanTree spans={spans} />);

    expect(screen.getByRole('button', { name: 'select span root-a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'select span root-b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select span child-a' })).not.toBeInTheDocument();
  });

  it('expands a root item when selected', () => {
    const spans: SigilSpan[] = [
      makeSpan({ selectionID: 'root', spanID: 'root', name: 'root', startNs: BigInt(1) }),
      makeSpan({ selectionID: 'child', spanID: 'child', parentSpanID: 'root', name: 'child', startNs: BigInt(2) }),
    ];

    render(<SigilSpanTree spans={spans} />);

    expect(screen.queryByRole('button', { name: 'select span child' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'select span root' }));
    expect(screen.getByRole('button', { name: 'select span child' })).toBeInTheDocument();
  });

  it('nests by parentSpanID within the same trace', () => {
    const spans: SigilSpan[] = [
      makeSpan({
        selectionID: 'root-trace-1',
        traceID: 'trace-1',
        spanID: 'root',
        name: 'root-trace-1',
        startNs: BigInt(1),
      }),
      makeSpan({
        selectionID: 'root-trace-2',
        traceID: 'trace-2',
        spanID: 'root',
        name: 'root-trace-2',
        startNs: BigInt(2),
      }),
      makeSpan({
        selectionID: 'child-trace-2',
        traceID: 'trace-2',
        spanID: 'child',
        parentSpanID: 'root',
        name: 'child-trace-2',
        startNs: BigInt(3),
      }),
    ];

    render(<SigilSpanTree spans={spans} />);

    expect(screen.queryByRole('button', { name: 'expand span root-trace-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'expand span root-trace-2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select span child-trace-2' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'expand span root-trace-2' }));

    expect(screen.getByRole('button', { name: 'select span child-trace-2' })).toBeInTheDocument();
  });
});
