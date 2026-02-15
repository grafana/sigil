import ConversationsPage from '../pages/ConversationsPage';
import type { ConversationsDataSource } from '../conversation/api';

const mockDataSource: ConversationsDataSource = {
  async listConversations() {
    return [
      {
        id: 'conv-1',
        title: 'Dashboard troubleshooting',
        created_at: '2026-02-13T10:00:00Z',
        updated_at: '2026-02-13T10:06:00Z',
        last_generation_at: '2026-02-13T10:06:00Z',
        generation_count: 4,
        rating_summary: {
          total_count: 2,
          good_count: 1,
          bad_count: 1,
          latest_rating: 'CONVERSATION_RATING_VALUE_BAD',
          latest_rated_at: '2026-02-13T10:05:00Z',
          has_bad_rating: true,
        },
        annotation_summary: {
          annotation_count: 2,
          latest_annotation_type: 'TRIAGE_STATUS',
          latest_annotated_at: '2026-02-13T10:06:00Z',
        },
      },
      {
        id: 'conv-2',
        title: 'Model card question',
        created_at: '2026-02-13T09:40:00Z',
        updated_at: '2026-02-13T09:45:00Z',
        last_generation_at: '2026-02-13T09:45:00Z',
        generation_count: 2,
      },
    ];
  },

  async getConversation(conversationID) {
    return {
      id: conversationID,
      title: conversationID === 'conv-1' ? 'Dashboard troubleshooting' : 'Model card question',
      created_at: '2026-02-13T10:00:00Z',
      updated_at: '2026-02-13T10:06:00Z',
      last_generation_at: '2026-02-13T10:06:00Z',
      generation_count: conversationID === 'conv-1' ? 4 : 2,
      rating_summary: {
        total_count: 2,
        good_count: 1,
        bad_count: 1,
        latest_rating: 'CONVERSATION_RATING_VALUE_BAD',
        latest_rated_at: '2026-02-13T10:05:00Z',
        has_bad_rating: true,
      },
      annotation_summary: {
        annotation_count: 2,
        latest_annotation_type: 'TRIAGE_STATUS',
        latest_annotated_at: '2026-02-13T10:06:00Z',
      },
    };
  },

  async listConversationRatings() {
    return [
      {
        rating_id: 'rat-1',
        conversation_id: 'conv-1',
        rating: 'CONVERSATION_RATING_VALUE_BAD',
        comment: 'Need clearer dashboard context mapping.',
        created_at: '2026-02-13T10:05:00Z',
      },
      {
        rating_id: 'rat-2',
        conversation_id: 'conv-1',
        rating: 'CONVERSATION_RATING_VALUE_GOOD',
        comment: 'Follow-up answer was accurate.',
        created_at: '2026-02-13T10:04:00Z',
      },
    ];
  },

  async listConversationAnnotations() {
    return [
      {
        annotation_id: 'ann-1',
        conversation_id: 'conv-1',
        annotation_type: 'TRIAGE_STATUS',
        body: 'Escalated to prompt-quality queue.',
        operator_id: 'sre-1',
        operator_name: 'SRE Operator',
        created_at: '2026-02-13T10:06:00Z',
      },
      {
        annotation_id: 'ann-2',
        conversation_id: 'conv-1',
        annotation_type: 'FOLLOW_UP',
        body: 'Need replay with fixed context payload.',
        operator_id: 'sre-2',
        operator_name: 'On-call Engineer',
        created_at: '2026-02-13T10:03:00Z',
      },
    ];
  },
};

const meta = {
  title: 'Sigil/Conversations Page',
  component: ConversationsPage,
  args: {
    dataSource: mockDataSource,
  },
};

export default meta;
export const Default = {};
