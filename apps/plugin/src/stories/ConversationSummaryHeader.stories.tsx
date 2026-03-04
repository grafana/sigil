import ConversationSummaryHeader from '../components/conversations/ConversationSummaryHeader';
import type { ConversationSearchResult } from '../conversation/types';

const baseConversation: ConversationSearchResult = {
  conversation_id: 'conv-3f8e9d42',
  generation_count: 12,
  first_generation_at: '2026-02-15T09:00:00Z',
  last_generation_at: '2026-02-15T10:30:00Z',
  models: ['gpt-4o', 'claude-sonnet-4-5'],
  agents: ['assistant'],
  error_count: 1,
  has_errors: true,
  trace_ids: ['trace-1'],
  annotation_count: 2,
};

const meta = {
  title: 'Sigil/Conversations/ConversationSummaryHeader',
  component: ConversationSummaryHeader,
};

export default meta;

export const WithTitle = {
  args: {
    conversation: {
      ...baseConversation,
      conversation_title: 'Incident Follow-up: Payment Webhook Retries',
    },
  },
};

export const WithoutTitle = {
  args: {
    conversation: baseConversation,
  },
};
