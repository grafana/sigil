import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import ConversationTraces from '../components/conversations/ConversationTraces';
import {
  mockTraceTimelines,
  mockTrace1,
  mockTrace2,
  mockTrace3,
  mockTraceConversationDetail,
} from './mockTraceData';

const meta = {
  title: 'Sigil/Conversation Traces',
  component: ConversationTraces,
};

export default meta;

export const Default = {
  args: {
    detail: mockTraceConversationDetail,
    traceTimelines: mockTraceTimelines,
    traceLoadTotal: 4,
    traceLoadRunning: false,
    traceLoadFailures: 0,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const ExpandedTrace = {
  args: {
    detail: mockTraceConversationDetail,
    traceTimelines: mockTraceTimelines,
    traceLoadTotal: 4,
    traceLoadRunning: false,
    traceLoadFailures: 0,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter initialEntries={[`/?trace=${mockTrace1.traceID}`]}>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const WithSelectedSpan = {
  args: {
    detail: mockTraceConversationDetail,
    traceTimelines: mockTraceTimelines,
    traceLoadTotal: 4,
    traceLoadRunning: false,
    traceLoadFailures: 0,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter initialEntries={[`/?trace=${mockTrace2.traceID}&span=${mockTrace2.traceID}:rag0000000000004`]}>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const Loading = {
  args: {
    detail: mockTraceConversationDetail,
    traceTimelines: [],
    traceLoadTotal: 4,
    traceLoadRunning: true,
    traceLoadFailures: 0,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const PartialFailure = {
  args: {
    detail: mockTraceConversationDetail,
    traceTimelines: [mockTrace1, mockTrace2, mockTrace3],
    traceLoadTotal: 4,
    traceLoadRunning: false,
    traceLoadFailures: 1,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const SingleTrace = {
  args: {
    detail: {
      ...mockTraceConversationDetail,
      generation_count: 1,
      generations: mockTraceConversationDetail.generations.slice(0, 1),
    },
    traceTimelines: [mockTrace1],
    traceLoadTotal: 1,
    traceLoadRunning: false,
    traceLoadFailures: 0,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};
