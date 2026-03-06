import React from 'react';
import { useStyles2 } from '@grafana/ui';
import type { ConversationSpan } from '../../conversation/types';
import type { GenerationCostResult, GenerationDetail } from '../../generation/types';
import type { FlowNode } from './types';
import ChatThread from './ChatThread';
import ConversationMetricsStrip from './ConversationMetricsStrip';
import GenerationView from './GenerationView';
import { getStyles } from './DetailPanel.styles';

export type DetailPanelProps = {
  selectedNode: FlowNode | null;
  allGenerations: GenerationDetail[];
  flowNodes: FlowNode[];
  generationCosts?: Map<string, GenerationCostResult>;
  onDeselectNode: () => void;
  onNavigateToGeneration?: (generationId: string) => void;
  scrollToToolCallId?: string | null;
  onOpenTraceDrawer?: (span: ConversationSpan) => void;
  onCloseTraceDrawer?: () => void;
  isTraceDrawerOpen?: boolean;
};

export default function DetailPanel({
  selectedNode,
  allGenerations,
  flowNodes,
  generationCosts,
  onDeselectNode,
  onNavigateToGeneration,
  scrollToToolCallId,
  onOpenTraceDrawer,
  onCloseTraceDrawer,
  isTraceDrawerOpen,
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
          onOpenTraceDrawer={onOpenTraceDrawer}
          onCloseTraceDrawer={onCloseTraceDrawer}
          isTraceDrawerOpen={isTraceDrawerOpen}
        />
      ) : (
        <ChatThread generations={allGenerations} />
      )}
    </div>
  );
}
