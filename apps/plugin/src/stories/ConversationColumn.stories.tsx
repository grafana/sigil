import React from 'react';
import ConversationColumn from '../components/conversations/ConversationColumn';
import { mockSearchResults } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversation Column',
  component: ConversationColumn,
  args: {
    conversation: mockSearchResults[0],
  },
};

export default meta;

export const Default = {};
