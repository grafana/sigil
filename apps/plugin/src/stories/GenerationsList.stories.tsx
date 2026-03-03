import GenerationsList from '../components/conversations/GenerationsList';
import { mockConversationDetail, mockGenerationDetail, mockGenerationWithError } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversations/GenerationsList',
  component: GenerationsList,
};

export default meta;

export const Default = {
  args: {
    generations: mockConversationDetail.generations,
  },
};

export const WithErrors = {
  args: {
    generations: [...mockConversationDetail.generations, mockGenerationWithError],
  },
};

export const WithRenderedMessages = {
  args: {
    generations: [mockGenerationDetail, mockGenerationWithError],
  },
};

export const Empty = {
  args: {
    generations: [],
  },
};
