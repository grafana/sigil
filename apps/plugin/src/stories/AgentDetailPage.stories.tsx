import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgentDetailPage, { type AgentDetailPageProps } from '../pages/AgentDetailPage';
import type { AgentsDataSource } from '../agents/api';

const mockDataSource: AgentsDataSource = {
  listAgents: async () => ({ items: [], next_cursor: '' }),
  lookupAgent: async (name: string, version?: string) => ({
    agent_name: name,
    effective_version: version ?? 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    declared_version_first: '1.0.0',
    declared_version_latest: '2.4.0',
    first_seen_at: '2026-03-04T08:00:00Z',
    last_seen_at: '2026-03-04T11:30:00Z',
    generation_count: 422,
    system_prompt: 'You are the support assistant for production incidents.',
    system_prompt_prefix: 'You are the support assistant...',
    tool_count: 2,
    token_estimate: { system_prompt: 120, tools_total: 75, total: 195 },
    tools: [
      {
        name: 'search_incidents',
        description: 'Query incidents by service and severity',
        type: 'function',
        input_schema_json: '{"service":{"type":"string"},"severity":{"type":"string"}}',
        token_estimate: 28,
      },
      {
        name: 'fetch_runbook',
        description: 'Fetch runbook markdown by key',
        type: 'function',
        input_schema_json: '{"key":{"type":"string"}}',
        token_estimate: 17,
      },
    ],
    models: [
      {
        provider: 'openai',
        name: 'gpt-5',
        generation_count: 311,
        first_seen_at: '2026-03-04T08:00:00Z',
        last_seen_at: '2026-03-04T11:30:00Z',
      },
      {
        provider: 'anthropic',
        name: 'claude-sonnet-4-5',
        generation_count: 111,
        first_seen_at: '2026-03-04T08:10:00Z',
        last_seen_at: '2026-03-04T11:10:00Z',
      },
    ],
  }),
  listAgentVersions: async () => ({
    items: [
      {
        effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        declared_version_first: '1.0.0',
        declared_version_latest: '1.2.0',
        first_seen_at: '2026-03-04T08:00:00Z',
        last_seen_at: '2026-03-04T10:30:00Z',
        generation_count: 200,
        tool_count: 2,
        system_prompt_prefix: 'prompt A',
        token_estimate: { system_prompt: 96, tools_total: 64, total: 160 },
      },
      {
        effective_version: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        declared_version_first: '2.0.0',
        declared_version_latest: '2.4.0',
        first_seen_at: '2026-03-04T10:31:00Z',
        last_seen_at: '2026-03-04T11:30:00Z',
        generation_count: 222,
        tool_count: 2,
        system_prompt_prefix: 'prompt B',
        token_estimate: { system_prompt: 120, tools_total: 75, total: 195 },
      },
    ],
    next_cursor: '',
  }),
};

const meta = {
  title: 'Sigil/Agents/Agent Detail Page',
  component: AgentDetailPage,
  args: {
    dataSource: mockDataSource,
  },
  render: (args: AgentDetailPageProps) => (
    <MemoryRouter initialEntries={['/agents/name/support-assistant']}>
      <Routes>
        <Route path="/agents/name/:agentName" element={<AgentDetailPage {...args} />} />
      </Routes>
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};

export const Anonymous = {
  render: (args: AgentDetailPageProps) => (
    <MemoryRouter initialEntries={['/agents/anonymous']}>
      <Routes>
        <Route path="/agents/anonymous" element={<AgentDetailPage {...args} />} />
      </Routes>
    </MemoryRouter>
  ),
};
