import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationGenerations from './ConversationGenerations';
import type { ConversationData, ConversationSpan, SpanAttributeValue } from '../../conversation/types';

function makeAttrs(entries: Array<[string, SpanAttributeValue]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries);
}

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
    serviceName: 'llm-service',
    startTimeUnixNano: BigInt('1772480417578390317'),
    endTimeUnixNano: BigInt('1772480417752390317'),
    durationNano: BigInt('173999000'),
    attributes: new Map(),
    generation: null,
    children: [],
    ...overrides,
  };
}

function makeData(overrides: Partial<ConversationData> = {}): ConversationData {
  return {
    conversationID: 'conv-1',
    generationCount: 1,
    firstGenerationAt: '2026-03-01T10:00:00Z',
    lastGenerationAt: '2026-03-01T10:05:00Z',
    ratingSummary: null,
    annotations: [],
    spans: [],
    orphanGenerations: [],
    ...overrides,
  };
}

describe('ConversationGenerations', () => {
  it('shows AI spans and keeps root OTHER spans by default', () => {
    const sigilSpan = makeSpan({
      spanID: 'span-1',
      name: 'streamText gpt-4o-mini',
      attributes: makeAttrs([
        ['gen_ai.operation.name', { stringValue: 'streamText' }],
        ['sigil.generation.id', { stringValue: 'gen-1' }],
      ]),
    });
    const otherSpan = makeSpan({
      spanID: 'span-2',
      name: 'db.query',
      startTimeUnixNano: BigInt('1772480417578390318'),
    });
    const data = makeData({ spans: [sigilSpan, otherSpan] });

    render(<ConversationGenerations data={data} />);

    expect(screen.getByText('streamText gpt-4o-mini')).toBeInTheDocument();
  });

  it('shows all spans when All toggle is enabled', () => {
    const child = makeSpan({
      spanID: 'span-2',
      parentSpanID: 'span-1',
      name: 'db.query',
      startTimeUnixNano: BigInt('1772480417578390318'),
    });
    const root = makeSpan({
      spanID: 'span-1',
      name: 'streamText gpt-4o-mini',
      attributes: makeAttrs([
        ['gen_ai.operation.name', { stringValue: 'streamText' }],
        ['sigil.generation.id', { stringValue: 'gen-1' }],
      ]),
      children: [child],
    });
    const data = makeData({ spans: [root] });

    render(<ConversationGenerations data={data} />);

    fireEvent.click(screen.getByRole('switch', { name: 'toggle all spans' }));
    fireEvent.click(screen.getByRole('button', { name: 'expand span streamText gpt-4o-mini' }));

    expect(screen.getByText('db.query')).toBeInTheDocument();
  });

  it('shows generation count from data', () => {
    const data = makeData({ generationCount: 5, spans: [] });
    render(<ConversationGenerations data={data} />);
    expect(screen.getByText('Generations (5)')).toBeInTheDocument();
  });

  it('shows empty state when no generations', () => {
    const data = makeData({ generationCount: 0, spans: [] });
    render(<ConversationGenerations data={data} />);
    expect(screen.getByText('No generations in this conversation.')).toBeInTheDocument();
  });

  it('shows loading spinner', () => {
    const data = makeData();
    render(<ConversationGenerations data={data} loading />);
    expect(screen.getByTestId('Spinner')).toBeInTheDocument();
  });

  it('shows error message', () => {
    const data = makeData();
    render(<ConversationGenerations data={data} errorMessage="something went wrong" />);
    expect(screen.getByText('something went wrong')).toBeInTheDocument();
  });

  it('filters spans by free-text search', () => {
    const span1 = makeSpan({
      spanID: 'span-1',
      name: 'streamText gpt-4o-mini',
      attributes: makeAttrs([
        ['gen_ai.operation.name', { stringValue: 'streamText' }],
        ['sigil.generation.id', { stringValue: 'gen-1' }],
      ]),
    });
    const span2 = makeSpan({
      spanID: 'span-2',
      name: 'execute_tool weather',
      startTimeUnixNano: BigInt('1772480417578390417'),
      attributes: makeAttrs([['gen_ai.operation.name', { stringValue: 'execute_tool' }]]),
    });
    const data = makeData({ spans: [span1, span2] });

    render(<ConversationGenerations data={data} />);
    expect(screen.getByText('streamText gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('execute_tool weather')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'search spans' }), {
      target: { value: 'execute_tool' },
    });

    expect(screen.getByText('execute_tool weather')).toBeInTheDocument();
    expect(screen.queryByText('streamText gpt-4o-mini')).not.toBeInTheDocument();
  });
});
