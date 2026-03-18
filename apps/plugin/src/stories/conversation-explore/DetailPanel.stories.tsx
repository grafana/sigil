import React, { useState } from 'react';
import DetailPanel from '../../components/conversation-explore/DetailPanel';
import type { FlowNode } from '../../components/conversation-explore/types';
import {
  mockGenerations,
  mockFlowNodes,
  mockGenerationCosts,
  mockSyntheticGenerations,
  mockSyntheticFlowNodes,
} from './fixtures';

function DetailPanelWrapper({
  initialNode,
  generations = mockGenerations,
  flowNodes = mockFlowNodes,
}: {
  initialNode: FlowNode | null;
  generations?: typeof mockGenerations;
  flowNodes?: FlowNode[];
}) {
  const [node, setNode] = useState<FlowNode | null>(initialNode);
  return (
    <div style={{ width: 600, height: 600, border: '1px solid #333' }}>
      <DetailPanel
        selectedNode={node}
        allGenerations={generations}
        flowNodes={flowNodes}
        generationCosts={mockGenerationCosts}
        onDeselectNode={() => setNode(null)}
      />
    </div>
  );
}

const meta = {
  title: 'Sigil/Conversation Explore/DetailPanel',
  component: DetailPanel,
  render: (args: { initialNode: FlowNode | null; generations?: typeof mockGenerations; flowNodes?: FlowNode[] }) => (
    <DetailPanelWrapper initialNode={args.initialNode} generations={args.generations} flowNodes={args.flowNodes} />
  ),
};

export default meta;

export const ChatView = {
  args: { initialNode: null },
};

export const GenerationSelected = {
  args: { initialNode: mockFlowNodes[0].children[0] },
};

export const SyntheticNoTrace = {
  args: {
    initialNode: mockSyntheticFlowNodes[0].children[0],
    generations: mockSyntheticGenerations,
    flowNodes: mockSyntheticFlowNodes,
  },
};

export const Screenshot = ChatView;
