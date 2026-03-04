import React from 'react';
import ConversationMetricsStrip from '../../components/conversation-explore/ConversationMetricsStrip';
import { mockGenerations, mockFlowNodes, mockGenerationCosts } from './fixtures';
import type { GenerationDetail, GenerationCostResult } from '../../generation/types';
import type { FlowNode } from '../../components/conversation-explore/types';

const meta = {
  title: 'Sigil/Conversation Explore/ConversationMetricsStrip',
  component: ConversationMetricsStrip,
};

export default meta;

function Wrapper(props: {
  allGenerations: GenerationDetail[];
  flowNodes: FlowNode[];
  generationCosts?: Map<string, GenerationCostResult>;
}) {
  return (
    <div style={{ width: 700, border: '1px solid #333', borderRadius: 4 }}>
      <ConversationMetricsStrip
        allGenerations={props.allGenerations}
        flowNodes={props.flowNodes}
        generationCosts={props.generationCosts}
      />
    </div>
  );
}

export const Default = {
  render: () => (
    <Wrapper allGenerations={mockGenerations} flowNodes={mockFlowNodes} generationCosts={mockGenerationCosts} />
  ),
};

export const NoCost = {
  render: () => <Wrapper allGenerations={mockGenerations} flowNodes={mockFlowNodes} />,
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

const baseTime = new Date('2026-03-04T19:09:00Z').getTime();

const manyGenerations: GenerationDetail[] = Array.from({ length: 20 }, (_, i) => ({
  generation_id: `gen-many-${i}`,
  conversation_id: 'conv-many',
  trace_id: 'trace-many',
  span_id: `span-many-${i}`,
  mode: 'SYNC',
  model: {
    provider: i % 3 === 0 ? 'openai' : 'anthropic',
    name: i % 3 === 0 ? 'gpt-4o' : 'claude-sonnet-4-5',
  },
  usage: {
    input_tokens: 1000 + Math.floor(seededRandom(i) * 5000),
    output_tokens: 200 + Math.floor(seededRandom(i + 100) * 1500),
  },
  created_at: new Date(baseTime + i * 72_000).toISOString(),
}));

const manyFlowNodes: FlowNode[] = manyGenerations.map((gen, i) => ({
  id: `trace-many:span-many-${i}`,
  kind: 'generation' as const,
  label: 'generateText',
  durationMs: 500 + Math.floor(seededRandom(i + 200) * 4000),
  startMs: i * 5000,
  status: 'success' as const,
  model: gen.model?.name,
  provider: gen.model?.provider,
  tokenCount: (gen.usage?.input_tokens ?? 0) + (gen.usage?.output_tokens ?? 0),
  generation: gen,
  children: [],
}));

export const ManyGenerations = {
  render: () => <Wrapper allGenerations={manyGenerations} flowNodes={manyFlowNodes} />,
};

export const Screenshot = Default;
