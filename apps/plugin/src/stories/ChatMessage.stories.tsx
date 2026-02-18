import ChatMessage from '../components/chat/ChatMessage';
import {
  mockUserTextMessage,
  mockAssistantWithThinking,
  mockAssistantFinalAnswer,
  mockAssistantWithCodeBlock,
  mockToolResult,
  mockToolResultError,
} from './mockConversationData';

const meta = {
  title: 'Sigil/Chat/ChatMessage',
  component: ChatMessage,
};

export default meta;

export const UserText = {
  args: { message: mockUserTextMessage },
};

export const AssistantWithThinking = {
  args: { message: mockAssistantWithThinking },
};

export const AssistantFinalAnswer = {
  args: { message: mockAssistantFinalAnswer },
};

export const AssistantWithCode = {
  args: { message: mockAssistantWithCodeBlock },
};

export const ToolResultSuccess = {
  args: { message: mockToolResult },
};

export const ToolResultWithError = {
  args: { message: mockToolResultError },
};
