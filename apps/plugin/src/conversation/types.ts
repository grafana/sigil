export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
};

export type ConversationRatingValue = 'CONVERSATION_RATING_VALUE_GOOD' | 'CONVERSATION_RATING_VALUE_BAD';

export type ConversationRatingSummary = {
  total_count: number;
  good_count: number;
  bad_count: number;
  latest_rating?: ConversationRatingValue;
  latest_rated_at: string;
  latest_bad_at?: string;
  has_bad_rating: boolean;
};

export type ConversationAnnotationSummary = {
  annotation_count: number;
  latest_annotation_type?: string;
  latest_annotated_at: string;
};

export type ConversationListItem = {
  id: string;
  title?: string;
  last_generation_at: string;
  generation_count: number;
  created_at: string;
  updated_at: string;
  rating_summary?: ConversationRatingSummary;
  annotation_summary?: ConversationAnnotationSummary;
};

export type ConversationListResponse = {
  items: ConversationListItem[];
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

export type ConversationRatingsResponse = {
  items: ConversationRating[];
  next_cursor?: string;
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

export type ConversationAnnotationsResponse = {
  items: ConversationAnnotation[];
  next_cursor?: string;
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
