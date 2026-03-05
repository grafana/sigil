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

export type ConversationListItem = {
  id: string;
  title?: string;
  last_generation_at: string;
  generation_count: number;
  created_at: string;
  updated_at: string;
  rating_summary?: ConversationRatingSummary;
};

export type ConversationListResponse = {
  items: ConversationListItem[];
};

export type ConversationEvalSummary = {
  total_scores: number;
  pass_count: number;
  fail_count: number;
};

export type ConversationSearchResult = {
  conversation_id: string;
  conversation_title?: string;
  user_id?: string;
  generation_count: number;
  first_generation_at: string;
  last_generation_at: string;
  models: string[];
  model_providers?: Record<string, string>;
  agents: string[];
  error_count: number;
  has_errors: boolean;
  trace_ids: string[];
  rating_summary?: ConversationRatingSummary;
  annotation_count: number;
  eval_summary?: ConversationEvalSummary;
  selected?: Record<string, string[] | number>;
};

export type ConversationSearchResponse = {
  conversations: ConversationSearchResult[];
  next_cursor?: string;
  has_more: boolean;
};

export type GenerationLookupHints = {
  conversation_id?: string;
  from?: string;
  to?: string;
  at?: string;
};

export type {
  GenerationUsage,
  GenerationDetail,
  GenerationCostBreakdown,
  GenerationCostResult,
  Message,
  MessageRole,
  Part,
  PartMetadata,
  ToolCallPart,
  ToolResultPart,
  ToolDefinition,
} from '../generation/types';

export type ConversationDetail = {
  conversation_id: string;
  user_id?: string;
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

// Span types for the conversation data model

import type { GenerationDetail } from '../generation/types';

export type SpanAttributeValue = {
  stringValue?: string;
  intValue?: string;
  doubleValue?: string;
  boolValue?: boolean;
  arrayValue?: { values?: SpanAttributeValue[] };
};

export type SpanAttributes = ReadonlyMap<string, SpanAttributeValue>;

export type SpanKind = 'INTERNAL' | 'CLIENT' | 'SERVER' | 'PRODUCER' | 'CONSUMER' | 'UNSPECIFIED';

export type ConversationSpan = {
  traceID: string;
  spanID: string;
  parentSpanID: string;
  name: string;
  kind: SpanKind;
  serviceName: string;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
  durationNano: bigint;
  attributes: SpanAttributes;
  resourceAttributes: SpanAttributes;
  generation: GenerationDetail | null;
  children: ConversationSpan[];
};

export type ConversationData = {
  conversationID: string;
  userID?: string;
  generationCount: number;
  firstGenerationAt: string;
  lastGenerationAt: string;
  ratingSummary: ConversationRatingSummary | null;
  annotations: ConversationAnnotation[];
  spans: ConversationSpan[];
  orphanGenerations: GenerationDetail[];
};
