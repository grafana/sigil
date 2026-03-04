import React, { useMemo } from 'react';
import { useStyles2 } from '@grafana/ui';
import type { GenerationCostResult } from '../../generation/types';
import type { FlowNode } from './types';
import FlowNodeRow, { computeGenerationIndices, computeSiblingHighlights } from './FlowNodeRow';
import { getStyles } from './FlowTree.styles';

export type FlowTreeProps = {
  nodes: FlowNode[];
  selectedNodeId: string | null;
  onSelectNode: (node: FlowNode | null) => void;
  generationCosts?: Map<string, GenerationCostResult>;
};

export default function FlowTree({ nodes, selectedNodeId, onSelectNode, generationCosts }: FlowTreeProps) {
  const styles = useStyles2(getStyles);
  const genIndices = useMemo(() => computeGenerationIndices(nodes), [nodes]);
  const highlights = useMemo(() => computeSiblingHighlights(nodes, generationCosts), [nodes, generationCosts]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Flow</span>
      </div>
      <div className={styles.treeContainer} role="tree" aria-label="conversation flow">
        {nodes.length === 0 ? (
          <div className={styles.emptyState}>No operations found</div>
        ) : (
          nodes.map((node, i) => (
            <FlowNodeRow
              key={node.id}
              node={node}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              generationIndex={genIndices[i]}
              generationCosts={generationCosts}
              siblingHighlights={highlights}
            />
          ))
        )}
      </div>
    </div>
  );
}
