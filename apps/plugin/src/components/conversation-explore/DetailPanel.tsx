import React from 'react';
import { useStyles2 } from '@grafana/ui';
import type { GenerationCostResult, GenerationDetail } from '../../generation/types';
import type { FlowNode } from './types';
import ChatThread from './ChatThread';
import ConversationMetricsStrip from './ConversationMetricsStrip';
import GenerationView, { type AgentContextDrawerPayload } from './GenerationView';
import { getStyles } from './DetailPanel.styles';

export type DetailPanelProps = {
  selectedNode: FlowNode | null;
  allGenerations: GenerationDetail[];
  flowNodes: FlowNode[];
  generationCosts?: Map<string, GenerationCostResult>;
  onDeselectNode: () => void;
  onNavigateToGeneration?: (generationId: string) => void;
  scrollToToolCallId?: string | null;
  onOpenAgentContext?: (context: AgentContextDrawerPayload) => void;
};

export default function DetailPanel({
  selectedNode,
  allGenerations,
  flowNodes,
  generationCosts,
  onDeselectNode,
  onNavigateToGeneration,
  scrollToToolCallId,
  onOpenAgentContext,
}: DetailPanelProps) {
  const styles = useStyles2(getStyles);

  const showDetail = selectedNode !== null && selectedNode.kind !== 'agent';

  return (
    <div className={styles.container}>
      <ConversationMetricsStrip
        allGenerations={allGenerations}
        flowNodes={flowNodes}
        generationCosts={generationCosts}
      />
      {showDetail ? (
        <GenerationView
          node={selectedNode}
          allGenerations={allGenerations}
          onClose={onDeselectNode}
          onNavigateToGeneration={onNavigateToGeneration}
          scrollToToolCallId={scrollToToolCallId}
          onOpenAgentContext={onOpenAgentContext}
        />
      ) : (
        <ChatThread generations={allGenerations} />
      )}
    </div>
  );
}
