import React, { useState } from 'react';
import DetailPanel from '../../components/conversation-explore/DetailPanel';
import type { FlowNode } from '../../components/conversation-explore/types';
import { mockGenerations, mockFlowNodes, mockGenerationCosts } from './fixtures';

function DetailPanelWrapper({ initialNode }: { initialNode: FlowNode | null }) {
  const [node, setNode] = useState<FlowNode | null>(initialNode);
  return (
    <div style={{ width: 600, height: 600, border: '1px solid #333' }}>
      <DetailPanel
        selectedNode={node}
        allGenerations={mockGenerations}
        flowNodes={mockFlowNodes}
        generationCosts={mockGenerationCosts}
        onDeselectNode={() => setNode(null)}
      />
    </div>
  );
}

const meta = {
  title: 'Sigil/Conversation Explore/DetailPanel',
  component: DetailPanel,
  render: (args: { initialNode: FlowNode | null }) => <DetailPanelWrapper initialNode={args.initialNode} />,
};

export default meta;

export const ChatView = {
  args: { initialNode: null },
};

export const GenerationSelected = {
  args: { initialNode: mockFlowNodes[0].children[0] },
};

export const Screenshot = ChatView;
