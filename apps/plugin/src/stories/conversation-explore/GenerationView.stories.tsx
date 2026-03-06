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

export const WithScoreTooltip = {
  args: {
    node: mockFlowNodes[1].children[0],
    allGenerations: mockGenerations,
    onClose: () => {
      // Storybook interaction-only callback.
    },
  },
};

export const Screenshot = Default;
