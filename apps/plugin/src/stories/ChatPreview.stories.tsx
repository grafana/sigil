import ChatPreview from '../components/conversations/ChatPreview';
import { mockGenerationDetail, mockGenerationWithError } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversations/ChatPreview',
  component: ChatPreview,
};

export default meta;

export const Default = {
  args: {
    generationID: mockGenerationDetail.generation_id,
    input: mockGenerationDetail.input,
    output: mockGenerationDetail.output,
  },
};

export const OutputError = {
  args: {
    generationID: mockGenerationWithError.generation_id,
    input: mockGenerationWithError.input,
    output: mockGenerationWithError.output,
  },
};

export const Compact = {
  args: {
    generationID: mockGenerationDetail.generation_id,
    input: mockGenerationDetail.input,
    output: mockGenerationDetail.output,
    compact: true,
  },
};
