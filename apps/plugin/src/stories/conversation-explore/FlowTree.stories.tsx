import React, { useState } from 'react';
import FlowTree from '../../components/conversation-explore/FlowTree';
import type { FlowNode } from '../../components/conversation-explore/types';
import { mockFlowNodes, mockFlowNodesWithError } from './fixtures';

function FlowTreeWrapper({ nodes }: { nodes: FlowNode[] }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  return (
    <div style={{ width: 340, height: 500, border: '1px solid #333' }}>
      <FlowTree
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        onSelectNode={(node) => setSelectedNodeId(node?.id ?? null)}
      />
    </div>
  );
}

const meta = {
  title: 'Sigil/Conversation Explore/FlowTree',
  component: FlowTree,
  render: (args: { nodes: FlowNode[] }) => <FlowTreeWrapper nodes={args.nodes} />,
};

export default meta;

export const Default = {
  args: { nodes: mockFlowNodes },
};

export const WithErrors = {
  args: { nodes: mockFlowNodesWithError },
};

export const Empty = {
  args: { nodes: [] },
};

export const Screenshot = Default;
