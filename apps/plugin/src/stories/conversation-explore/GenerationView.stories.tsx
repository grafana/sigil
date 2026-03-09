import GenerationView from '../../components/conversation-explore/GenerationView';
import { mockFlowNodes, mockFlowNodesWithError, mockGenerations } from './fixtures';

const meta = {
  title: 'Sigil/Conversation Explore/GenerationView',
  component: GenerationView,
};

export default meta;

const generationNode = mockFlowNodes[0].children[0];
const errorNode = mockFlowNodesWithError[0].children[1];

export const Default = {
  args: {
    node: generationNode,
    allGenerations: mockGenerations,
    flowNodes: mockFlowNodes,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithError = {
  args: {
    node: errorNode,
    allGenerations: mockGenerations,
    flowNodes: mockFlowNodesWithError,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithScoreTooltip = {
  args: {
    node: mockFlowNodes[1].children[0],
    allGenerations: mockGenerations,
    flowNodes: mockFlowNodes,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithResourceAttributes = {
  args: {
    node: generationNode,
    allGenerations: mockGenerations,
    flowNodes: mockFlowNodes,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithRewrittenHistory = {
  args: {
    node: {
      id: 'rewrite-node',
      kind: 'generation',
      label: 'generateText',
      durationMs: 380,
      startMs: 0,
      status: 'success',
      generation: {
        generation_id: 'gen-rewrite-2',
        conversation_id: 'conv-rewrite',
        created_at: '2026-03-09T19:02:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Check Redis persistence.' }] },
          { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'What changed in the config?' }] },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Actually compare the new save policy against AOF rewrite impact.' }] },
        ],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'The rewritten prompt focuses on save cadence versus rewrite growth.' }] }],
      },
      children: [],
    },
    allGenerations: [
      {
        generation_id: 'gen-rewrite-1',
        conversation_id: 'conv-rewrite',
        created_at: '2026-03-09T19:01:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Check Redis persistence.' }] },
          { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'What changed in the config?' }] },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Compare the old replication backlog settings.' }] },
        ],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'The previous prompt focused on replication backlog settings.' }] }],
      },
      {
        generation_id: 'gen-rewrite-2',
        conversation_id: 'conv-rewrite',
        created_at: '2026-03-09T19:02:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Check Redis persistence.' }] },
          { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'What changed in the config?' }] },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Actually compare the new save policy against AOF rewrite impact.' }] },
        ],
        output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'The rewritten prompt focuses on save cadence versus rewrite growth.' }] }],
      },
    ],
    flowNodes: [],
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const Screenshot = Default;
