import { hydrateConversationDetailV2, type ConversationDetailV2 } from './detailV2';

describe('hydrateConversationDetailV2', () => {
  it('hydrates shared refs into the existing conversation detail shape', () => {
    const detail: ConversationDetailV2 = {
      conversation_id: 'conv-1',
      conversation_title: 'Conversation title',
      user_id: 'user-1',
      generation_count: 1,
      first_generation_at: '2026-03-10T09:00:00Z',
      last_generation_at: '2026-03-10T09:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          trace_id: 'trace-1',
          span_id: 'span-1',
          mode: 'SYNC',
          model: {
            provider: 'openai',
            name: 'gpt-4o',
          },
          agent_name: 'assistant',
          agent_version: '1.0.0',
          agent_effective_version: 'sha256:abc',
          agent_id: 'assistant',
          input_refs: [0],
          output_refs: [1],
          tool_refs: [0],
          system_prompt_ref: 0,
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
          stop_reason: 'end_turn',
          metadata_ref: 0,
          created_at: '2026-03-10T09:00:30Z',
          error: null,
          latest_scores: {
            quality: {
              value: { number: 0.9 },
              evaluator_id: 'eval-1',
              evaluator_version: '1',
              created_at: '2026-03-10T09:00:45Z',
            },
          },
        },
      ],
      rating_summary: {
        total_count: 1,
        good_count: 1,
        bad_count: 0,
        has_bad_rating: false,
      },
      annotations: [
        {
          annotation_id: 'ann-1',
          conversation_id: 'conv-1',
          annotation_type: 'NOTE',
          operator_id: 'op-1',
          created_at: '2026-03-10T09:01:00Z',
        },
      ],
      shared: {
        messages: [
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'hello' }],
          },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'hi' }],
          },
        ],
        tools: [
          {
            name: 'web_search',
            description: 'Search the web',
          },
        ],
        system_prompts: ['You are a helpful assistant.'],
        metadata: [
          {
            'sigil.conversation.title': 'Conversation title',
          },
        ],
      },
    };

    expect(hydrateConversationDetailV2(detail)).toEqual({
      conversation_id: 'conv-1',
      conversation_title: 'Conversation title',
      user_id: 'user-1',
      generation_count: 1,
      first_generation_at: '2026-03-10T09:00:00Z',
      last_generation_at: '2026-03-10T09:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          trace_id: 'trace-1',
          span_id: 'span-1',
          mode: 'SYNC',
          model: {
            provider: 'openai',
            name: 'gpt-4o',
          },
          agent_name: 'assistant',
          agent_version: '1.0.0',
          agent_effective_version: 'sha256:abc',
          agent_id: 'assistant',
          system_prompt: 'You are a helpful assistant.',
          input: [
            {
              role: 'MESSAGE_ROLE_USER',
              parts: [{ text: 'hello' }],
            },
          ],
          output: [
            {
              role: 'MESSAGE_ROLE_ASSISTANT',
              parts: [{ text: 'hi' }],
            },
          ],
          tools: [
            {
              name: 'web_search',
              description: 'Search the web',
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
          stop_reason: 'end_turn',
          metadata: {
            'sigil.conversation.title': 'Conversation title',
          },
          created_at: '2026-03-10T09:00:30Z',
          error: null,
          latest_scores: {
            quality: {
              value: { number: 0.9 },
              evaluator_id: 'eval-1',
              evaluator_version: '1',
              created_at: '2026-03-10T09:00:45Z',
            },
          },
        },
      ],
      rating_summary: {
        total_count: 1,
        good_count: 1,
        bad_count: 0,
        has_bad_rating: false,
      },
      annotations: [
        {
          annotation_id: 'ann-1',
          conversation_id: 'conv-1',
          annotation_type: 'NOTE',
          operator_id: 'op-1',
          created_at: '2026-03-10T09:01:00Z',
        },
      ],
    });
  });

  it('throws when a shared ref is out of bounds', () => {
    const detail: ConversationDetailV2 = {
      conversation_id: 'conv-1',
      generation_count: 1,
      first_generation_at: '2026-03-10T09:00:00Z',
      last_generation_at: '2026-03-10T09:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          input_refs: [1],
        },
      ],
      annotations: [],
      shared: {
        messages: [
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'hello' }],
          },
        ],
      },
    };

    expect(() => hydrateConversationDetailV2(detail)).toThrow('invalid message ref: 1');
  });
});
