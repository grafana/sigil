import ConversationsPage from '../pages/ConversationsPage';
import type { ConversationsDataSource } from '../conversation/api';

const mockDataSource: ConversationsDataSource = {
  async searchConversations() {
    return {
      conversations: [
        {
          conversation_id: 'conv-1',
          generation_count: 4,
          first_generation_at: '2026-02-15T09:40:00Z',
          last_generation_at: '2026-02-15T10:06:00Z',
          models: ['gpt-4o'],
          agents: ['assistant'],
          error_count: 1,
          has_errors: true,
          trace_ids: ['trace-1', 'trace-2'],
          annotation_count: 2,
          rating_summary: {
            total_count: 2,
            good_count: 1,
            bad_count: 1,
            has_bad_rating: true,
          },
        },
        {
          conversation_id: 'conv-2',
          generation_count: 2,
          first_generation_at: '2026-02-15T08:00:00Z',
          last_generation_at: '2026-02-15T08:30:00Z',
          models: ['gpt-4o-mini'],
          agents: ['triage-bot'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-3'],
          annotation_count: 0,
        },
      ],
      next_cursor: '',
      has_more: false,
    };
  },

  async getConversationDetail(conversationID) {
    return {
      conversation_id: conversationID,
      generation_count: conversationID === 'conv-1' ? 4 : 2,
      first_generation_at: '2026-02-15T09:40:00Z',
      last_generation_at: '2026-02-15T10:06:00Z',
      generations: [
        {
          generation_id: `${conversationID}-gen-1`,
          conversation_id: conversationID,
          trace_id: 'trace-1',
          mode: 'SYNC',
          created_at: '2026-02-15T09:40:00Z',
          model: { provider: 'openai', name: 'gpt-4o' },
        },
        {
          generation_id: `${conversationID}-gen-2`,
          conversation_id: conversationID,
          trace_id: 'trace-2',
          mode: 'STREAM',
          created_at: '2026-02-15T10:06:00Z',
          model: { provider: 'openai', name: 'gpt-4o' },
        },
      ],
      rating_summary: {
        total_count: 2,
        good_count: 1,
        bad_count: 1,
        has_bad_rating: true,
      },
      annotations: [
        {
          annotation_id: 'ann-1',
          conversation_id: conversationID,
          annotation_type: 'NOTE',
          body: 'Escalated for review',
          operator_id: 'oncall-1',
          created_at: '2026-02-15T10:07:00Z',
        },
      ],
    };
  },

  async getGeneration(generationID) {
    return {
      generation_id: generationID,
      conversation_id: generationID.split('-gen-')[0],
      trace_id: 'trace-1',
      mode: 'SYNC',
      model: { provider: 'openai', name: 'gpt-4o' },
      usage: {
        input_tokens: 120,
        output_tokens: 42,
        total_tokens: 162,
      },
      created_at: '2026-02-15T09:40:00Z',
    };
  },

  async getSearchTags() {
    return [
      { key: 'model', scope: 'well-known', description: 'Model name' },
      { key: 'agent', scope: 'well-known', description: 'Agent name' },
      { key: 'status', scope: 'well-known', description: 'Error status' },
      { key: 'resource.k8s.namespace.name', scope: 'resource' },
    ];
  },

  async getSearchTagValues(tag) {
    if (tag === 'model') {
      return ['gpt-4o', 'gpt-4o-mini'];
    }
    if (tag === 'agent') {
      return ['assistant', 'triage-bot'];
    }
    return [];
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
