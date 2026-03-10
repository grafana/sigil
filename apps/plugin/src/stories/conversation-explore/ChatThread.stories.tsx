import ChatThread from '../../components/conversation-explore/ChatThread';
import { mockGenerations, mockGenerationsWithToolResults, mockGenerationsWithXml } from './fixtures';

const meta = {
  title: 'Sigil/Conversation Explore/ChatThread',
  component: ChatThread,
};

export default meta;

export const Default = {
  args: { generations: mockGenerations },
};

export const SingleGeneration = {
  args: { generations: [mockGenerations[0]] },
};

export const WithToolResults = {
  args: { generations: mockGenerationsWithToolResults },
};

export const WithXmlBlocks = {
  args: { generations: mockGenerationsWithXml },
};

export const WithCumulativeHistory = {
  args: {
    generations: [
      {
        generation_id: 'gen-cumulative-1',
        conversation_id: 'conv-cumulative',
        created_at: '2026-03-09T19:00:00Z',
        input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What changed in Redis?' }] }],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'I checked the Redis configuration.' }] }],
      },
      {
        generation_id: 'gen-cumulative-2',
        conversation_id: 'conv-cumulative',
        created_at: '2026-03-09T19:01:00Z',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What changed in Redis?' }] },
          { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'I checked the Redis configuration.' }] },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Did the save policy affect AOF rewrites?' }] },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'The new save policy did not change rewrite behavior in the latest window.' }],
          },
        ],
      },
    ],
  },
};

export const Empty = {
  args: { generations: [] },
};

export const Screenshot = Default;
