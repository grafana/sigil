import GenerationView from '../../components/conversation-explore/GenerationView';
import { mockFlowNodes, mockFlowNodesWithError, mockGenerations } from './fixtures';

const meta = {
  title: 'Sigil/Conversation Explore/GenerationView',
  component: GenerationView,
};

export default meta;

const generationNode = mockFlowNodes[0].children[0];
const errorNode = mockFlowNodesWithError[0].children[1];
const generationNodeWithAgentLink = {
  ...generationNode,
  generation: generationNode.generation
    ? {
        ...generationNode.generation,
        agent_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }
    : generationNode.generation,
};
const generationNodeWithDeclaredVersionOnly = {
  ...generationNode,
  generation: generationNode.generation
    ? {
        ...generationNode.generation,
        agent_effective_version: undefined,
        agent_id: undefined,
        agent_version: '1.2.3',
      }
    : generationNode.generation,
};

export const Default = {
  args: {
    node: generationNode,
    allGenerations: mockGenerations,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithError = {
  args: {
    node: errorNode,
    allGenerations: mockGenerations,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithAgentPageLink = {
  args: {
    node: generationNodeWithAgentLink,
    allGenerations: mockGenerations.map((generation) =>
      generation.generation_id === generationNode.generation?.generation_id
        ? {
            ...generation,
            agent_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }
        : generation
    ),
    onClose: () => {
      // Storybook interaction-only callback.
    },
    onOpenAgentContext: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const WithDeclaredVersionOnly = {
  args: {
    node: generationNodeWithDeclaredVersionOnly,
    allGenerations: mockGenerations.map((generation) =>
      generation.generation_id === generationNode.generation?.generation_id
        ? {
            ...generation,
            agent_effective_version: undefined,
            agent_id: undefined,
            agent_version: '1.2.3',
          }
        : generation
    ),
    onClose: () => {
      // Storybook interaction-only callback.
    },
    onOpenAgentContext: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const Screenshot = Default;
