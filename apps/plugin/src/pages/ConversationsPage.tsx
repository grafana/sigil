import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Spinner, Stack, Text } from '@grafana/ui';
import type {
  ConversationAnnotation,
  ConversationListItem,
  ConversationRating,
  ConversationTimelineEvent,
} from '../conversation/types';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { buildConversationTimeline, formatTimestamp } from '../conversation/timeline';

type BooleanFilterValue = 'all' | 'true' | 'false';

export type ConversationsPageProps = {
  dataSource?: ConversationsDataSource;
};

function toOptionalFilterValue(value: BooleanFilterValue): boolean | undefined {
  if (value === 'all') {
    return undefined;
  }
  return value === 'true';
}

export default function ConversationsPage(props: ConversationsPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const [hasBadRatingFilter, setHasBadRatingFilter] = useState<BooleanFilterValue>('all');
  const [hasAnnotationsFilter, setHasAnnotationsFilter] = useState<BooleanFilterValue>('all');

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedConversationID, setSelectedConversationID] = useState<string>('');
  const [selectedConversation, setSelectedConversation] = useState<ConversationListItem | null>(null);
  const [ratings, setRatings] = useState<ConversationRating[]>([]);
  const [annotations, setAnnotations] = useState<ConversationAnnotation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setLoadingList(true);
        setErrorMessage('');
      }
    });

    void dataSource
      .listConversations({
        hasBadRating: toOptionalFilterValue(hasBadRatingFilter),
        hasAnnotations: toOptionalFilterValue(hasAnnotationsFilter),
      })
      .then((items) => {
        if (cancelled) {
          return;
        }
        setConversations(items);
        setSelectedConversationID((currentSelectedID) => {
          if (currentSelectedID.length > 0 && items.some((item) => item.id === currentSelectedID)) {
            return currentSelectedID;
          }
          return items[0]?.id ?? '';
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
        setConversations([]);
        setSelectedConversationID('');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingList(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, hasBadRatingFilter, hasAnnotationsFilter]);

  useEffect(() => {
    let cancelled = false;
    if (selectedConversationID.length === 0) {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setSelectedConversation(null);
          setRatings([]);
          setAnnotations([]);
          setLoadingDetails(false);
        }
      });
      return;
    }

    void Promise.resolve().then(() => {
      if (!cancelled) {
        setLoadingDetails(true);
        setErrorMessage('');
      }
    });

    void Promise.all([
      dataSource.getConversation(selectedConversationID),
      dataSource.listConversationRatings(selectedConversationID),
      dataSource.listConversationAnnotations(selectedConversationID),
    ])
      .then(([conversation, conversationRatings, conversationAnnotations]) => {
        if (cancelled) {
          return;
        }
        setSelectedConversation(conversation);
        setRatings(conversationRatings);
        setAnnotations(conversationAnnotations);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversation details');
        setSelectedConversation(null);
        setRatings([]);
        setAnnotations([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetails(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, selectedConversationID]);

  const timelineEvents = useMemo<ConversationTimelineEvent[]>(
    () => buildConversationTimeline(ratings, annotations),
    [ratings, annotations]
  );

  return (
    <Stack direction="column" gap={2}>
      <h2>Conversations</h2>

      <Stack direction="row" gap={2} wrap>
        <label>
          <Text element="span">Has BAD rating</Text>
          <select
            aria-label="has bad rating filter"
            value={hasBadRatingFilter}
            onChange={(event) => setHasBadRatingFilter(event.currentTarget.value as BooleanFilterValue)}
          >
            <option value="all">All</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label>
          <Text element="span">Has annotations</Text>
          <select
            aria-label="has annotations filter"
            value={hasAnnotationsFilter}
            onChange={(event) => setHasAnnotationsFilter(event.currentTarget.value as BooleanFilterValue)}
          >
            <option value="all">All</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </Stack>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <Stack direction="row" gap={3}>
        <Stack direction="column" gap={1}>
          <h4>Conversation list</h4>
          {loadingList && <Spinner aria-label="loading conversations" />}
          {!loadingList && conversations.length === 0 && <Text>No conversations found for current filters.</Text>}
          {!loadingList &&
            conversations.map((conversation) => {
              const selected = conversation.id === selectedConversationID;
              const ratingSummary = conversation.rating_summary;
              const annotationSummary = conversation.annotation_summary;

              return (
                <button
                  key={conversation.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedConversationID(conversation.id)}
                  style={{
                    textAlign: 'left',
                    padding: '8px',
                    border: selected ? '2px solid #3274d9' : '1px solid #3a4250',
                    borderRadius: '6px',
                    background: selected ? 'rgba(50,116,217,0.1)' : 'transparent',
                    cursor: 'pointer',
                    minWidth: '360px',
                  }}
                >
                  <Text>
                    <strong>{conversation.title || conversation.id}</strong>
                  </Text>
                  <Text color="secondary">ID: {conversation.id}</Text>
                  <Text color="secondary">Generations: {conversation.generation_count}</Text>
                  {ratingSummary && (
                    <Text color="secondary">
                      Ratings: {ratingSummary.good_count} good / {ratingSummary.bad_count} bad
                    </Text>
                  )}
                  {annotationSummary && (
                    <Text color="secondary">Annotations: {annotationSummary.annotation_count}</Text>
                  )}
                </button>
              );
            })}
        </Stack>

        <Stack direction="column" gap={1}>
          <h4>Conversation detail</h4>
          {selectedConversationID.length === 0 && <Text>Select a conversation to inspect details.</Text>}
          {loadingDetails && selectedConversationID.length > 0 && <Spinner aria-label="loading conversation details" />}
          {!loadingDetails && selectedConversationID.length > 0 && selectedConversation && (
            <Stack direction="column" gap={1}>
              <Text>
                <strong>{selectedConversation.title || selectedConversation.id}</strong>
              </Text>
              <Text color="secondary">Updated: {formatTimestamp(selectedConversation.updated_at)}</Text>
              <Text color="secondary">Last generation: {formatTimestamp(selectedConversation.last_generation_at)}</Text>

              <h5>Ratings timeline ({ratings.length})</h5>
              {ratings.length === 0 && <Text color="secondary">No ratings yet.</Text>}
              {ratings.map((rating) => (
                <Stack key={rating.rating_id} direction="row" gap={1}>
                  <Badge
                    color={rating.rating === 'CONVERSATION_RATING_VALUE_BAD' ? 'red' : 'green'}
                    text={rating.rating === 'CONVERSATION_RATING_VALUE_BAD' ? 'BAD' : 'GOOD'}
                  />
                  <Text>{formatTimestamp(rating.created_at)}</Text>
                  <Text>{rating.comment?.trim() || 'No comment provided.'}</Text>
                </Stack>
              ))}

              <h5>Annotations timeline ({annotations.length})</h5>
              {annotations.length === 0 && <Text color="secondary">No annotations yet.</Text>}
              {annotations.map((annotation) => (
                <Stack key={annotation.annotation_id} direction="row" gap={1}>
                  <Badge color="blue" text={annotation.annotation_type} />
                  <Text>{formatTimestamp(annotation.created_at)}</Text>
                  <Text>{annotation.body?.trim() || 'No body provided.'}</Text>
                </Stack>
              ))}

              <h5>Merged timeline ({timelineEvents.length})</h5>
              {timelineEvents.length === 0 && <Text color="secondary">No timeline events.</Text>}
              {timelineEvents.map((event) => (
                <Stack key={event.id} direction="row" gap={1}>
                  <Badge color={event.kind === 'rating' ? 'orange' : 'blue'} text={event.badge} />
                  <Text>{formatTimestamp(event.createdAt)}</Text>
                  <Text>
                    <strong>{event.title}</strong> {event.description}
                  </Text>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}
