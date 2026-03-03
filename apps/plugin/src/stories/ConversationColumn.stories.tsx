import ConversationColumn from '../components/conversations/ConversationColumn';
import { mockConversationDetail, mockSearchResults } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversation Column',
  component: ConversationColumn,
  args: {
    conversation: mockSearchResults[0],
    generations: mockConversationDetail.generations,
    generationsLoading: false,
    generationsErrorMessage: '',
  },
};

export default meta;

export const Default = {};
