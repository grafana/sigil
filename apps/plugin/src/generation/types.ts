import type { ModelCard, ModelCardPricing } from '../modelcard/types';

export type MessageRole = 'MESSAGE_ROLE_USER' | 'MESSAGE_ROLE_ASSISTANT' | 'MESSAGE_ROLE_TOOL';

export type PartMetadata = {
  provider_type?: string;
};

export type ToolCallPart = {
  id: string;
  name: string;
  input_json?: string;
};

export type ToolResultPart = {
  tool_call_id: string;
  name: string;
  content?: string;
  content_json?: string;
  is_error?: boolean;
};

export type Part = {
  metadata?: PartMetadata;
  text?: string;
  thinking?: string;
  tool_call?: ToolCallPart;
  tool_result?: ToolResultPart;
};

export type Message = {
  role: MessageRole;
  name?: string;
  parts: Part[];
};

export type ToolDefinition = {
  name: string;
  description?: string;
  type?: string;
  input_schema_json?: string;
};

export type GenerationUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_write_input_tokens?: number;
  reasoning_tokens?: number;
};

export type LatestScoreValue = {
  number?: number;
  bool?: boolean;
  string?: string;
};

export type LatestScore = {
  value: LatestScoreValue;
  evaluator_id: string;
  evaluator_version: string;
  evaluator_description?: string;
  explanation?: string;
  created_at: string;
  passed?: boolean | null;
};

export type GenerationDetail = {
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
  system_prompt?: string;
  input?: Message[];
  output?: Message[];
  tools?: ToolDefinition[];
  usage?: GenerationUsage;
  stop_reason?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  error?: null | { message?: string };
  latest_scores?: Record<string, LatestScore>;
};

export type GenerationCostBreakdown = {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
};

export type GenerationCostResult = {
  generationID: string;
  model: string;
  provider: string;
  card: ModelCard;
  breakdown: GenerationCostBreakdown;
};

export function formatScoreValue(value: LatestScoreValue): string {
  if (value.number !== undefined) {
    return Number.isInteger(value.number) ? String(value.number) : value.number.toFixed(3);
  }
  if (value.bool !== undefined) {
    return value.bool ? 'true' : 'false';
  }
  if (value.string !== undefined) {
    return value.string;
  }
  return '—';
}

export type { ModelCard, ModelCardPricing };
