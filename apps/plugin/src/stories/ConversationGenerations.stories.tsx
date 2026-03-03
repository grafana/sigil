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

export const WithTraceLinkedGenerations = {
  args: {
    generations: mockConversationDetail.generations.map((generation) => ({
      ...generation,
      trace_id: generation.trace_id ?? `trace-${generation.generation_id}`,
    })),
  },
};
