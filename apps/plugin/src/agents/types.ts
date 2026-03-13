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

export type AgentAttributeFilter = {
  key: string;
  operator: '=' | '!=' | '=~';
  value: string;
};

export type AgentSearchRequest = {
  filters: string;
  time_range: {
    from: string;
    to: string;
  };
  page_size: number;
  cursor?: string;
  name_prefix?: string;
};

export type AgentRuntimeValueCount = {
  value: string;
  count: number;
};

export type AgentRuntimeContextGroup = {
  key: string;
  values: AgentRuntimeValueCount[];
};

export type AgentRuntimeContextRequest = {
  agent_name: string;
  effective_version?: string;
  filters: string;
  time_range: {
    from: string;
    to: string;
  };
};

export type AgentRuntimeContextResponse = {
  matching_generation_count: number;
  first_seen_at?: string;
  last_seen_at?: string;
  groups: AgentRuntimeContextGroup[];
};

export type AgentTool = {
  name: string;
  description: string;
  type: string;
  input_schema_json: string;
  deferred?: boolean;
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

export type PromptInsight = {
  quote: string;
  title: string;
  explanation: string;
};

export type PromptInsightsStatus = 'pending' | 'completed' | 'failed';

export type PromptInsightsResponse = {
  status: PromptInsightsStatus;
  strengths: PromptInsight[];
  weaknesses: PromptInsight[];
  judge_model: string;
  judge_latency_ms: number;
};

export type AnalyzePromptRequest = {
  agent_name: string;
  version?: string;
  model?: string;
  lookback?: string;
};

export type LookbackOption = {
  label: string;
  value: string;
  description: string;
};

export const LOOKBACK_OPTIONS: LookbackOption[] = [
  { label: '6 hours', value: '6h', description: 'Last 6 hours' },
  { label: '12 hours', value: '12h', description: 'Last 12 hours' },
  { label: '1 day', value: '1d', description: 'Last day' },
  { label: '3 days', value: '3d', description: 'Last 3 days' },
  { label: '7 days', value: '7d', description: 'Last 7 days' },
];

export const DEFAULT_LOOKBACK = '7d';
