import GenerationView from '../../components/conversation-explore/GenerationView';
import {
  mockFlowNodes,
  mockFlowNodesWithError,
  mockGenerations,
  mockSyntheticFlowNodes,
  mockSyntheticGenerations,
} from './fixtures';

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
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'Actually compare the new save policy against AOF rewrite impact.' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'The rewritten prompt focuses on save cadence versus rewrite growth.' }],
          },
        ],
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
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'The previous prompt focused on replication backlog settings.' }],
          },
        ],
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
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'Actually compare the new save policy against AOF rewrite impact.' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'The rewritten prompt focuses on save cadence versus rewrite growth.' }],
          },
        ],
      },
    ],
    flowNodes: [],
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithToolResultMessage = {
  args: {
    node: mockFlowNodes[0].children[1],
    allGenerations: mockGenerations,
    flowNodes: mockFlowNodes,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithVisibleMultiTurnInput = {
  args: {
    node: {
      id: 'multi-turn-node',
      kind: 'generation',
      label: 'generateText',
      durationMs: 310,
      startMs: 0,
      status: 'success',
      generation: {
        generation_id: 'gen-multi-turn',
        conversation_id: 'conv-multi-turn',
        created_at: '2026-03-09T19:04:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Summarize the current Redis rollout.' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'The rollout is stable in staging and partially enabled in production.' }],
          },
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'Call out the riskiest instance group before we widen traffic.' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              { text: 'The riskiest group is the us-central1 canary shard because persistence lag is still spiking.' },
            ],
          },
        ],
      },
      children: [],
    },
    allGenerations: [
      {
        generation_id: 'gen-multi-turn',
        conversation_id: 'conv-multi-turn',
        created_at: '2026-03-09T19:04:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Summarize the current Redis rollout.' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'The rollout is stable in staging and partially enabled in production.' }],
          },
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'Call out the riskiest instance group before we widen traffic.' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              { text: 'The riskiest group is the us-central1 canary shard because persistence lag is still spiking.' },
            ],
          },
        ],
      },
    ],
    flowNodes: [],
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithCumulativeHistory = {
  args: {
    node: {
      id: 'cumulative-node',
      kind: 'generation',
      label: 'generateText',
      durationMs: 420,
      startMs: 0,
      status: 'success',
      generation: {
        generation_id: 'gen-cumul-3',
        conversation_id: 'conv-cumul',
        created_at: '2026-03-09T19:03:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What services are in the Agent Management group?' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              {
                text: 'Agent Management contains 28-39 services responsible for managing agent configs and deployments.',
              },
            ],
          },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Which Kubernetes clusters does it span?' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'It spans two production clusters in us-central1 and eu-west1.' }],
          },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Show me the memory usage trend for the last 24h.' }] },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'Here is the memory usage trend across both clusters for the past 24 hours.' }],
          },
        ],
      },
      children: [],
    },
    allGenerations: [
      {
        generation_id: 'gen-cumul-1',
        conversation_id: 'conv-cumul',
        created_at: '2026-03-09T19:01:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What services are in the Agent Management group?' }] }],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              {
                text: 'Agent Management contains 28-39 services responsible for managing agent configs and deployments.',
              },
            ],
          },
        ],
      },
      {
        generation_id: 'gen-cumul-2',
        conversation_id: 'conv-cumul',
        created_at: '2026-03-09T19:02:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What services are in the Agent Management group?' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              {
                text: 'Agent Management contains 28-39 services responsible for managing agent configs and deployments.',
              },
            ],
          },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Which Kubernetes clusters does it span?' }] },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'It spans two production clusters in us-central1 and eu-west1.' }],
          },
        ],
      },
      {
        generation_id: 'gen-cumul-3',
        conversation_id: 'conv-cumul',
        created_at: '2026-03-09T19:03:00Z',
        model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
        agent_name: 'fe-grafana-assistant',
        input: [
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What services are in the Agent Management group?' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              {
                text: 'Agent Management contains 28-39 services responsible for managing agent configs and deployments.',
              },
            ],
          },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Which Kubernetes clusters does it span?' }] },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'It spans two production clusters in us-central1 and eu-west1.' }],
          },
          { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Show me the memory usage trend for the last 24h.' }] },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'Here is the memory usage trend across both clusters for the past 24 hours.' }],
          },
        ],
      },
    ],
    flowNodes: [],
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const SyntheticNoTrace = {
  args: {
    node: mockSyntheticFlowNodes[0].children[0],
    allGenerations: mockSyntheticGenerations,
    flowNodes: mockSyntheticFlowNodes,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const SyntheticWithScores = {
  args: {
    node: mockSyntheticFlowNodes[1].children[0],
    allGenerations: mockSyntheticGenerations,
    flowNodes: mockSyntheticFlowNodes,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const Screenshot = Default;
