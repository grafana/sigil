export type ConversationRatingValue = 'CONVERSATION_RATING_VALUE_GOOD' | 'CONVERSATION_RATING_VALUE_BAD';

export type ConversationRatingSummary = {
  total_count: number;
  good_count: number;
  bad_count: number;
  latest_rating?: ConversationRatingValue;
  latest_rated_at?: string;
  latest_bad_at?: string;
  has_bad_rating: boolean;
};

export type ConversationAnnotation = {
  annotation_id: string;
  conversation_id: string;
  generation_id?: string;
  annotation_type: string;
  body?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  operator_id: string;
  operator_login?: string;
  operator_name?: string;
  created_at: string;
};

export type ConversationRating = {
  rating_id: string;
  conversation_id: string;
  generation_id?: string;
  rating: ConversationRatingValue;
  comment?: string;
  metadata?: Record<string, unknown>;
  rater_id?: string;
  source?: string;
  created_at: string;
};

export type ConversationTimelineEventKind = 'rating' | 'annotation';

export type ConversationTimelineEvent = {
  id: string;
  kind: ConversationTimelineEventKind;
  createdAt: string;
  badge: string;
  title: string;
  description: string;
};

export type ConversationSearchTimeRange = {
  from: string;
  to: string;
};

export type ConversationSearchRequest = {
  filters: string;
  select: string[];
  time_range: ConversationSearchTimeRange;
  page_size: number;
  cursor?: string;
};

export type ConversationSearchResult = {
  conversation_id: string;
  generation_count: number;
  first_generation_at: string;
  last_generation_at: string;
  models: string[];
  agents: string[];
  error_count: number;
  has_errors: boolean;
  trace_ids: string[];
  rating_summary?: ConversationRatingSummary;
  annotation_count: number;
  selected?: Record<string, string[] | number>;
};

export type ConversationSearchResponse = {
  conversations: ConversationSearchResult[];
  next_cursor?: string;
  has_more: boolean;
};

export type GenerationUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: number | undefined;
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
  system_prompt?: string;
  input?: unknown[];
  output?: unknown[];
  tools?: unknown[];
  usage?: GenerationUsage;
  stop_reason?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  error?: null | { message?: string };
  [key: string]: unknown;
};

export type ConversationDetail = {
  conversation_id: string;
  generation_count: number;
  first_generation_at: string;
  last_generation_at: string;
  generations: GenerationDetail[];
  rating_summary?: ConversationRatingSummary;
  annotations: ConversationAnnotation[];
};

export type SearchTag = {
  key: string;
  scope: 'well-known' | 'span' | 'resource';
  description?: string;
};

export type SearchTagsResponse = {
  tags: SearchTag[];
};

export type SearchTagValuesResponse = {
  values: string[];
};

// --- Message / Part types (matching generation_ingest.proto) ---

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
