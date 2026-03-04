import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import AgentsPage, { type AgentsPageProps } from '../pages/AgentsPage';
import type { AgentsDataSource } from '../agents/api';
import type { DashboardDataSource } from '../dashboard/api';

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
        system_prompt_prefix: 'You are support assistant for production incidents.',
        token_estimate: { system_prompt: 88, tools_total: 132, total: 220 },
      },
      {
        agent_name: 'code-reviewer',
        latest_effective_version: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        first_seen_at: '2026-03-03T14:00:00Z',
        latest_seen_at: '2026-03-04T10:45:00Z',
        generation_count: 1208,
        version_count: 3,
        tool_count: 12,
        system_prompt_prefix: 'You review pull requests and provide feedback on code quality.',
        token_estimate: { system_prompt: 220, tools_total: 840, total: 1060 },
      },
      {
        agent_name: 'data-analyst',
        latest_effective_version: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        first_seen_at: '2026-02-01T09:00:00Z',
        latest_seen_at: '2026-02-20T09:30:00Z',
        generation_count: 89,
        version_count: 6,
        tool_count: 4,
        system_prompt_prefix: 'You are a data analyst agent that queries metrics and builds dashboards.',
        token_estimate: { system_prompt: 150, tools_total: 400, total: 550 },
      },
      {
        agent_name: '',
        latest_effective_version: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        first_seen_at: '2026-03-04T09:00:00Z',
        latest_seen_at: '2026-03-04T11:20:00Z',
        generation_count: 41,
        version_count: 4,
        tool_count: 0,
        system_prompt_prefix: '',
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

const mockDashboardDataSource: DashboardDataSource = {
  queryRange: async () => ({ status: 'success', data: { resultType: 'matrix', result: [] } }),
  queryInstant: async () => ({
    status: 'success',
    data: {
      resultType: 'vector',
      result: [
        {
          metric: {
            gen_ai_agent_name: 'support-assistant',
            gen_ai_provider_name: 'openai',
            gen_ai_request_model: 'gpt-4o-mini',
            gen_ai_token_type: 'input',
          },
          value: [0, '120000'],
        },
      ],
    },
  }),
  labels: async () => [],
  labelValues: async () => [],
  resolveModelCards: async () => ({
    resolved: [],
    freshness: {
      catalog_last_refreshed_at: null,
      stale: false,
      soft_stale: false,
      hard_stale: false,
      source_path: '',
    },
  }),
};

const meta = {
  title: 'Sigil/Agents/Agents Page',
  component: AgentsPage,
  args: {
    dataSource: mockDataSource,
    dashboardDataSource: mockDashboardDataSource,
  },
  render: (args: AgentsPageProps) => (
    <MemoryRouter initialEntries={['/agents']}>
      <AgentsPage {...args} />
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};
