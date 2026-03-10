import type { ConversationAnnotation, ConversationDetail, ConversationRatingSummary } from './types';
import type {
  GenerationDetail,
  GenerationUsage,
  LatestScore,
  Message,
  ToolDefinition,
} from '../generation/types';

type SharedConversationDetailV2 = {
  messages?: Message[];
  tools?: ToolDefinition[];
  system_prompts?: string[];
  metadata?: Record<string, unknown>[];
};

type GenerationDetailV2 = {
  generation_id: string;
  conversation_id: string;
  trace_id?: string;
  span_id?: string;
  mode?: string;
  model?: {
    provider?: string;
    name?: string;
  };
  agent_name?: string;
  agent_version?: string;
  agent_effective_version?: string;
  agent_id?: string;
  input_refs?: number[];
  output_refs?: number[];
  tool_refs?: number[];
  system_prompt_ref?: number;
  usage?: GenerationUsage;
  stop_reason?: string;
  metadata_ref?: number;
  created_at?: string;
  error?: null | { message?: string };
  latest_scores?: Record<string, LatestScore>;
};

export type ConversationDetailV2 = {
  conversation_id: string;
  conversation_title?: string;
  user_id?: string;
  generation_count: number;
  first_generation_at: string;
  last_generation_at: string;
  generations: GenerationDetailV2[];
  rating_summary?: ConversationRatingSummary;
  annotations: ConversationAnnotation[];
  shared?: SharedConversationDetailV2;
};

function isValidSharedIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function resolveSharedIndex<T>(items: T[], index: number | undefined, label: string): T | undefined {
  if (index === undefined) {
    return undefined;
  }
  if (!isValidSharedIndex(index, items.length)) {
    throw new Error(`invalid ${label} ref: ${index}`);
  }
  return items[index];
}

function resolveSharedRefs<T>(items: T[], indexes: number[] | undefined, label: string): T[] | undefined {
  if (indexes === undefined) {
    return undefined;
  }
  return indexes.map((index) => {
    const value = resolveSharedIndex(items, index, label);
    if (value === undefined) {
      throw new Error(`missing ${label} ref: ${index}`);
    }
    return value;
  });
}

function hydrateGenerationDetail(generation: GenerationDetailV2, shared: SharedConversationDetailV2): GenerationDetail {
  const messages = shared.messages ?? [];
  const tools = shared.tools ?? [];
  const systemPrompts = shared.system_prompts ?? [];
  const metadata = shared.metadata ?? [];

  return {
    generation_id: generation.generation_id,
    conversation_id: generation.conversation_id,
    trace_id: generation.trace_id,
    span_id: generation.span_id,
    mode: generation.mode,
    model: generation.model,
    agent_name: generation.agent_name,
    agent_version: generation.agent_version,
    agent_effective_version: generation.agent_effective_version,
    agent_id: generation.agent_id,
    system_prompt: resolveSharedIndex(systemPrompts, generation.system_prompt_ref, 'system_prompt'),
    input: resolveSharedRefs(messages, generation.input_refs, 'message'),
    output: resolveSharedRefs(messages, generation.output_refs, 'message'),
    tools: resolveSharedRefs(tools, generation.tool_refs, 'tool'),
    usage: generation.usage,
    stop_reason: generation.stop_reason,
    metadata: resolveSharedIndex(metadata, generation.metadata_ref, 'metadata'),
    created_at: generation.created_at,
    error: generation.error,
    latest_scores: generation.latest_scores,
  };
}

export function hydrateConversationDetailV2(detail: ConversationDetailV2): ConversationDetail {
  const shared = detail.shared ?? {};

  return {
    conversation_id: detail.conversation_id,
    conversation_title: detail.conversation_title,
    user_id: detail.user_id,
    generation_count: detail.generation_count,
    first_generation_at: detail.first_generation_at,
    last_generation_at: detail.last_generation_at,
    generations: (detail.generations ?? []).map((generation) => hydrateGenerationDetail(generation, shared)),
    rating_summary: detail.rating_summary,
    annotations: detail.annotations ?? [],
  };
}
