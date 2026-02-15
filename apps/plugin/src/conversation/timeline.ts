import type { ConversationAnnotation, ConversationRating, ConversationTimelineEvent } from './types';

const badRatingValue = 'CONVERSATION_RATING_VALUE_BAD';

export function buildConversationTimeline(
  ratings: ConversationRating[],
  annotations: ConversationAnnotation[]
): ConversationTimelineEvent[] {
  const ratingEvents: ConversationTimelineEvent[] = ratings.map((rating) => {
    const isBad = rating.rating === badRatingValue;
    const comment = (rating.comment ?? '').trim();
    return {
      id: `rating:${rating.rating_id}`,
      kind: 'rating',
      createdAt: rating.created_at,
      badge: isBad ? 'BAD rating' : 'GOOD rating',
      title: isBad ? 'User marked response as bad' : 'User marked response as good',
      description: comment.length > 0 ? comment : 'No comment provided.',
    };
  });

  const annotationEvents: ConversationTimelineEvent[] = annotations.map((annotation) => {
    const body = (annotation.body ?? '').trim();
    const actor = (annotation.operator_name ?? annotation.operator_login ?? annotation.operator_id ?? '').trim();
    const prefix = actor.length > 0 ? `${actor}: ` : '';
    return {
      id: `annotation:${annotation.annotation_id}`,
      kind: 'annotation',
      createdAt: annotation.created_at,
      badge: annotation.annotation_type,
      title: 'Operator annotation',
      description: `${prefix}${body.length > 0 ? body : 'No body provided.'}`,
    };
  });

  return [...ratingEvents, ...annotationEvents].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return rightTime - leftTime;
  });
}

export function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}
