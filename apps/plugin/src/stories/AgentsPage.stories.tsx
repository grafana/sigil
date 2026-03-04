import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import AgentsPage, { type AgentsPageProps } from '../pages/AgentsPage';
import type { AgentsDataSource } from '../agents/api';

const mockDataSource: AgentsDataSource = {
  listAgents: async () => ({
    items: [
      {
        agent_name: 'support-assistant',
        latest_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        latest_declared_version: '2.4.0',
        first_seen_at: '2026-03-04T08:00:00Z',
        latest_seen_at: '2026-03-04T11:20:00Z',
        generation_count: 422,
        version_count: 8,
        tool_count: 6,
        system_prompt_prefix: 'You are support assistant...',
        token_estimate: { system_prompt: 88, tools_total: 132, total: 220 },
      },
      {
        agent_name: '',
        latest_effective_version: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        first_seen_at: '2026-03-04T09:00:00Z',
        latest_seen_at: '2026-03-04T11:20:00Z',
        generation_count: 41,
        version_count: 4,
        tool_count: 0,
        system_prompt_prefix: 'anonymous...',
        token_estimate: { system_prompt: 22, tools_total: 0, total: 22 },
      },
    ],
    next_cursor: '',
  }),
  lookupAgent: async () => {
    throw new Error('not implemented in AgentsPage story');
  },
  listAgentVersions: async () => ({ items: [], next_cursor: '' }),
};

const meta = {
  title: 'Sigil/Agents/Agents Page',
  component: AgentsPage,
  args: {
    dataSource: mockDataSource,
  },
  render: (args: AgentsPageProps) => (
    <MemoryRouter initialEntries={['/agents']}>
      <AgentsPage {...args} />
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};
