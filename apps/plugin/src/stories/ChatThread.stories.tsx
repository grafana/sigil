import ChatThread from '../components/chat/ChatThread';
import { mockFullConversationMessages, mockUserTextMessage, mockAssistantFinalAnswer } from './mockConversationData';

const meta = {
  title: 'Sigil/Chat/ChatThread',
  component: ChatThread,
};

export default meta;

export const FullConversation = {
  args: { messages: mockFullConversationMessages },
};

export const SimpleExchange = {
  args: {
    messages: [mockUserTextMessage, mockAssistantFinalAnswer],
  },
};

export const Empty = {
  args: { messages: [] },
};
