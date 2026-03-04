import React from 'react';
import { render, screen } from '@testing-library/react';
import SpanDetailPanel from './SpanDetailPanel';
import type { ConversationSpan, SpanAttributeValue } from '../../conversation/types';
import type { GenerationDetail } from '../../generation/types';

function makeAttrs(entries: Array<[string, string]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries.map(([key, value]) => [key, { stringValue: value }]));
}

function makeSpan(overrides: Partial<ConversationSpan> = {}): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID: 'span-gen-1',
    parentSpanID: '',
    name: 'generateText gpt-4o',
    kind: 'CLIENT',
    serviceName: 'llm-gateway',
    startTimeUnixNano: BigInt('1772480417578390317'),
    endTimeUnixNano: BigInt('1772480417752390317'),
    durationNano: BigInt('173999000'),
    attributes: new Map(),
    resourceAttributes: new Map(),
    generation: null,
    children: [],
    ...overrides,
  };
}

const sampleGeneration: GenerationDetail = {
  generation_id: 'gen-1',
  conversation_id: 'conv-1',
  trace_id: 'trace-1',
  span_id: 'span-gen-1',
  mode: 'SYNC',
  model: { provider: 'openai', name: 'gpt-4o' },
  created_at: '2026-03-04T10:00:00Z',
};

describe('SpanDetailPanel', () => {
  it('shows generation sections when span.generation is set', () => {
    const span = makeSpan({ generation: sampleGeneration });
    render(<SpanDetailPanel span={span} />);
    expect(screen.getByText('Generation')).toBeInTheDocument();
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('shows generation when allGenerations matches exact span_id', () => {
    const span = makeSpan();
    render(<SpanDetailPanel span={span} allGenerations={[sampleGeneration]} />);
    expect(screen.getByText('Generation')).toBeInTheDocument();
  });

  it('does not show generation sections when span has no generation and span_id does not match', () => {
    const toolSpan = makeSpan({
      spanID: 'span-tool-1',
      name: 'execute_tool web_search',
      attributes: makeAttrs([['gen_ai.operation.name', 'execute_tool']]),
    });
    // sampleGeneration belongs to 'span-gen-1', not 'span-tool-1'
    render(<SpanDetailPanel span={toolSpan} allGenerations={[sampleGeneration]} />);
    expect(screen.queryByText('Generation')).not.toBeInTheDocument();
    expect(screen.queryByText('Token Usage')).not.toBeInTheDocument();
    expect(screen.queryByText('Conversation')).not.toBeInTheDocument();
  });

  it('does not show Conversation thread when span has no generation', () => {
    const frameworkSpan = makeSpan({
      spanID: 'span-framework-1',
      name: 'sigil.framework.chain',
    });
    render(<SpanDetailPanel span={frameworkSpan} allGenerations={[sampleGeneration]} />);
    expect(screen.queryByText('Conversation')).not.toBeInTheDocument();
  });

  it('always shows Span and attribute sections', () => {
    const toolSpan = makeSpan({
      spanID: 'span-tool-1',
      attributes: makeAttrs([['gen_ai.operation.name', 'execute_tool']]),
      resourceAttributes: makeAttrs([['service.name', 'my-service']]),
    });
    render(<SpanDetailPanel span={toolSpan} allGenerations={[sampleGeneration]} />);
    expect(screen.getByText('Span')).toBeInTheDocument();
    expect(screen.getByText(/Span Attributes/)).toBeInTheDocument();
    expect(screen.getByText(/Resource Attributes/)).toBeInTheDocument();
  });
});
