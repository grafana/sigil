import React from 'react';
import ConversationGenerations from '../components/conversations/ConversationGenerations';
import { mockConversationDetail } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversation Generations',
  component: ConversationGenerations,
  args: {
    generations: mockConversationDetail.generations,
    loading: false,
    errorMessage: '',
  },
};

export default meta;

export const Default = {};

export const Loading = {
  args: {
    loading: true,
  },
};

export const Empty = {
  args: {
    generations: [],
  },
};
