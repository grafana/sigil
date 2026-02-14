import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConversationsPage from './ConversationsPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationAnnotation, ConversationListItem, ConversationRating } from '../conversation/types';

type MockConversationsDataSource = {
  [Key in keyof ConversationsDataSource]: jest.MockedFunction<ConversationsDataSource[Key]>;
};

function createDataSource(overrides?: Partial<MockConversationsDataSource>): MockConversationsDataSource {
  return {
    listConversations: jest.fn(async (_filter) => [] as ConversationListItem[]),
    getConversation: jest.fn(async (conversationID: string) => ({
      id: conversationID,
      title: conversationID,
      created_at: '2026-02-13T10:00:00Z',
      updated_at: '2026-02-13T10:00:00Z',
      last_generation_at: '2026-02-13T10:00:00Z',
      generation_count: 1,
    })),
    listConversationRatings: jest.fn(async (_conversationID: string, _limit?: number) => [] as ConversationRating[]),
    listConversationAnnotations: jest.fn(
      async (_conversationID: string, _limit?: number) => [] as ConversationAnnotation[]
    ),
    ...overrides,
  };
}

describe('ConversationsPage', () => {
  it('renders conversation summaries and merged timeline entries', async () => {
    const conversationItems: ConversationListItem[] = [
      {
        id: 'conv-1',
        title: 'Conversation One',
        created_at: '2026-02-13T10:00:00Z',
        updated_at: '2026-02-13T10:00:00Z',
        last_generation_at: '2026-02-13T10:00:00Z',
        generation_count: 3,
        rating_summary: {
          total_count: 2,
          good_count: 1,
          bad_count: 1,
          latest_rating: 'CONVERSATION_RATING_VALUE_BAD',
          latest_rated_at: '2026-02-13T10:05:00Z',
          has_bad_rating: true,
        },
        annotation_summary: {
          annotation_count: 1,
          latest_annotation_type: 'TRIAGE_STATUS',
          latest_annotated_at: '2026-02-13T10:06:00Z',
        },
      },
    ];
    const ratingItems: ConversationRating[] = [
      {
        rating_id: 'rat-1',
        conversation_id: 'conv-1',
        rating: 'CONVERSATION_RATING_VALUE_BAD',
        comment: 'Incorrect answer',
        created_at: '2026-02-13T10:05:00Z',
      },
      {
        rating_id: 'rat-0',
        conversation_id: 'conv-1',
        rating: 'CONVERSATION_RATING_VALUE_GOOD',
        comment: '',
        created_at: '2026-02-13T10:03:00Z',
      },
    ];
    const annotationItems: ConversationAnnotation[] = [
      {
        annotation_id: 'ann-1',
        conversation_id: 'conv-1',
        annotation_type: 'TRIAGE_STATUS',
        body: 'Needs follow-up',
        operator_id: 'alice',
        created_at: '2026-02-13T10:06:00Z',
      },
    ];

    const dataSource = createDataSource({
      listConversations: jest.fn(async (_filter) => conversationItems),
      listConversationRatings: jest.fn(async (_conversationID: string, _limit?: number) => ratingItems),
      listConversationAnnotations: jest.fn(async (_conversationID: string, _limit?: number) => annotationItems),
    });

    render(<ConversationsPage dataSource={dataSource} />);

    await screen.findByText('Conversation One');
    expect(screen.getByText('Ratings: 1 good / 1 bad')).toBeInTheDocument();
    expect(screen.getByText('Annotations: 1')).toBeInTheDocument();

    const mergedEntries = await screen.findAllByText(/User marked response as|Operator annotation/);
    expect(mergedEntries[0]).toHaveTextContent('Operator annotation');
    expect(mergedEntries[1]).toHaveTextContent('User marked response as bad');
  });

  it('applies has_bad_rating and has_annotations filters', async () => {
    const dataSource = createDataSource();
    render(<ConversationsPage dataSource={dataSource} />);

    await waitFor(() =>
      expect(dataSource.listConversations).toHaveBeenCalledWith({
        hasBadRating: undefined,
        hasAnnotations: undefined,
      })
    );

    fireEvent.change(screen.getByLabelText('has bad rating filter'), { target: { value: 'true' } });
    await waitFor(() =>
      expect(dataSource.listConversations).toHaveBeenLastCalledWith({
        hasBadRating: true,
        hasAnnotations: undefined,
      })
    );

    fireEvent.change(screen.getByLabelText('has annotations filter'), { target: { value: 'false' } });
    await waitFor(() =>
      expect(dataSource.listConversations).toHaveBeenLastCalledWith({
        hasBadRating: true,
        hasAnnotations: false,
      })
    );
  });

  it('loads selected conversation details when switching rows', async () => {
    const conversationItems: ConversationListItem[] = [
      {
        id: 'conv-1',
        title: 'Conversation One',
        created_at: '2026-02-13T10:00:00Z',
        updated_at: '2026-02-13T10:00:00Z',
        last_generation_at: '2026-02-13T10:00:00Z',
        generation_count: 1,
      },
      {
        id: 'conv-2',
        title: 'Conversation Two',
        created_at: '2026-02-13T10:01:00Z',
        updated_at: '2026-02-13T10:01:00Z',
        last_generation_at: '2026-02-13T10:01:00Z',
        generation_count: 2,
      },
    ];

    const dataSource = createDataSource({
      listConversations: jest.fn(async (_filter) => conversationItems),
    });

    render(<ConversationsPage dataSource={dataSource} />);
    await screen.findByText('Conversation Two');

    fireEvent.click(screen.getByRole('button', { name: /conversation two/i }));
    await waitFor(() => expect(dataSource.getConversation).toHaveBeenCalledWith('conv-2'));
    await waitFor(() => expect(dataSource.listConversationRatings).toHaveBeenCalledWith('conv-2'));
    await waitFor(() => expect(dataSource.listConversationAnnotations).toHaveBeenCalledWith('conv-2'));
  });
});
