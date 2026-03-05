export type AgentTokenEstimate = {
  system_prompt: number;
  tools_total: number;
  total: number;
};

export type AgentListItem = {
  agent_name: string;
  latest_effective_version: string;
  latest_declared_version?: string;
  first_seen_at: string;
  latest_seen_at: string;
  generation_count: number;
  version_count: number;
  tool_count: number;
  system_prompt_prefix: string;
  token_estimate: AgentTokenEstimate;
};

export type AgentListResponse = {
  items: AgentListItem[];
  next_cursor: string;
};

export type AgentTool = {
  name: string;
  description: string;
  type: string;
  input_schema_json: string;
  token_estimate: number;
};

export type AgentModelUsage = {
  provider: string;
  name: string;
  generation_count: number;
  first_seen_at: string;
  last_seen_at: string;
};

export type AgentDetail = {
  agent_name: string;
  effective_version: string;
  declared_version_first?: string;
  declared_version_latest?: string;
  first_seen_at: string;
  last_seen_at: string;
  generation_count: number;
  system_prompt: string;
  system_prompt_prefix: string;
  tool_count: number;
  token_estimate: AgentTokenEstimate;
  tools: AgentTool[];
  models: AgentModelUsage[];
};

export type AgentVersionListItem = {
  effective_version: string;
  declared_version_first?: string;
  declared_version_latest?: string;
  first_seen_at: string;
  last_seen_at: string;
  generation_count: number;
  tool_count: number;
  system_prompt_prefix: string;
  token_estimate: AgentTokenEstimate;
};

export type AgentVersionListResponse = {
  items: AgentVersionListItem[];
  next_cursor: string;
};

export type AgentRatingRequest = {
  agent_name: string;
  version?: string;
  model?: string;
};

export type AgentRatingSuggestion = {
  category: string;
  severity: string;
  title: string;
  description: string;
};

export type AgentRatingStatus = 'pending' | 'completed' | 'failed';

export type AgentRatingResponse = {
  status?: AgentRatingStatus;
  score: number;
  summary: string;
  suggestions: AgentRatingSuggestion[];
  token_warning?: string;
  judge_model: string;
  judge_latency_ms: number;
};
