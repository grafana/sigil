import ConversationsPage from '../pages/ConversationsPage';
import type { ConversationsDataSource } from '../conversation/api';
import {
  mockSearchResults,
  mockConversationDetail,
  mockGenerationDetail,
  mockGenerationWithError,
} from './mockConversationData';

const generationsByIndex: Record<string, typeof mockGenerationDetail> = {
  'gen-abc-001': mockGenerationDetail,
  'gen-abc-002': {
    ...mockGenerationDetail,
    generation_id: 'gen-abc-002',
    input: [
      {
        role: 'MESSAGE_ROLE_USER',
        parts: [{ text: 'Follow up: can you show me a Python hello world?' }],
      },
    ],
    output: [
      {
        role: 'MESSAGE_ROLE_ASSISTANT',
        parts: [
          {
            text: 'Sure! Here is a simple Python hello world:\n\n```python\nprint("Hello, World!")\n```\n\nJust save this as `hello.py` and run it with `python hello.py`.',
          },
        ],
      },
    ],
  },
  'gen-abc-003': mockGenerationWithError,
};

const mockDataSource: ConversationsDataSource = {
  async searchConversations() {
    return {
      conversations: mockSearchResults,
      next_cursor: '',
      has_more: false,
    };
  },

  async streamSearchConversations(_request, options) {
    options.onResults(mockSearchResults.slice(0, 1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    options.onResults(mockSearchResults.slice(1));
    options.onComplete({ next_cursor: '', has_more: false });
  },

  async getConversationDetail(conversationID) {
    if (conversationID === 'conv-xyz-789') {
      return mockConversationDetail;
    }
    return {
      conversation_id: conversationID,
      generation_count: 1,
      first_generation_at: '2026-02-15T09:00:00Z',
      last_generation_at: '2026-02-15T09:05:00Z',
      generations: [
        {
          generation_id: `${conversationID}-gen-1`,
          conversation_id: conversationID,
          trace_id: 'trace-100',
          mode: 'SYNC',
          created_at: '2026-02-15T09:00:00Z',
          model: { provider: 'openai', name: 'gpt-4o-mini' },
        },
      ],
      annotations: [],
    };
  },

  async getGeneration(generationID) {
    const gen = generationsByIndex[generationID];
    if (gen) {
      return gen;
    }
    return {
      generation_id: generationID,
      conversation_id: 'unknown',
      mode: 'SYNC',
      model: { provider: 'openai', name: 'gpt-4o-mini' },
      input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Hello' }] }],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'Hi! How can I help you today?' }] }],
      usage: { input_tokens: 10, output_tokens: 15, total_tokens: 25 },
      created_at: '2026-02-15T09:00:00Z',
    };
  },

  async getSearchTags() {
    return [
      { key: 'model', scope: 'well-known' as const, description: 'Model name' },
      { key: 'agent', scope: 'well-known' as const, description: 'Agent name' },
      { key: 'status', scope: 'well-known' as const, description: 'Error status' },
      { key: 'resource.k8s.namespace.name', scope: 'resource' as const },
    ];
  },

  async getSearchTagValues(tag) {
    if (tag === 'model') {
      return ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-5'];
    }
    if (tag === 'agent') {
      return ['research-assistant', 'triage-bot', 'code-review-bot'];
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
