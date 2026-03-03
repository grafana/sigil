import GenerationItem from '../components/conversations/GenerationItem';
import { mockGenerationDetail, mockGenerationWithError } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversations/GenerationItem',
  component: GenerationItem,
};

export default meta;

export const Default = {
  args: {
    generation: mockGenerationDetail,
    index: 0,
  },
};

export const WithError = {
  args: {
    generation: mockGenerationWithError,
    index: 1,
  },
};
