import type { ConversationSpan } from '../../conversation/types';
import type { GenerationDetail } from '../../generation/types';

export type FlowNodeKind = 'agent' | 'generation' | 'tool' | 'tool_call' | 'embedding';

export type FlowNodeStatus = 'success' | 'error';

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  durationMs: number;
  startMs: number;
  status: FlowNodeStatus;
  model?: string;
  provider?: string;
  tokenCount?: number;
  generation?: GenerationDetail;
  span?: ConversationSpan;
  children: FlowNode[];
  toolCallId?: string;
  parentNodeId?: string;
};

const ACCENT_HUES = [260, 160, 30, 330, 90, 210, 120, 60];

export function modelAccentColor(model: string): string {
  let hash = 0;
  for (let i = 0; i < model.length; i++) {
    hash = ((hash << 5) - hash + model.charCodeAt(i)) | 0;
  }
  const hue = ACCENT_HUES[Math.abs(hash) % ACCENT_HUES.length];
  return `oklch(0.65 0.15 ${hue})`;
}

export function extractModelFromLabel(label: string): string {
  const spaceIndex = label.indexOf(' ');
  return spaceIndex === -1 ? label : label.slice(spaceIndex + 1);
}

export function resolveModelKey(node: FlowNode): string | undefined {
  if (node.kind !== 'generation') {
    return undefined;
  }
  return node.model ?? extractModelFromLabel(node.label);
}
