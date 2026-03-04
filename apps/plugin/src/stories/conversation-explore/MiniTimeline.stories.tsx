import React, { useState } from 'react';
import MiniTimeline from '../../components/conversation-explore/MiniTimeline';
import type { FlowNode } from '../../components/conversation-explore/types';
import { mockFlowNodes } from './fixtures';

function MiniTimelineWrapper({ nodes, totalDurationMs }: { nodes: FlowNode[]; totalDurationMs: number }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  return (
    <div style={{ width: 340 }}>
      <MiniTimeline
        nodes={nodes}
        totalDurationMs={totalDurationMs}
        selectedNodeId={selectedNodeId}
        onSelectNode={(node) => setSelectedNodeId(node?.id ?? null)}
      />
    </div>
  );
}

const meta = {
  title: 'Sigil/Conversation Explore/MiniTimeline',
  component: MiniTimeline,
  render: (args: { nodes: FlowNode[]; totalDurationMs: number }) => (
    <MiniTimelineWrapper nodes={args.nodes} totalDurationMs={args.totalDurationMs} />
  ),
};

export default meta;

export const Default = {
  args: {
    nodes: mockFlowNodes,
    totalDurationMs: 8430,
  },
};

export const Screenshot = Default;
