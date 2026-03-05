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
    tool_count: 8,
    token_estimate: { system_prompt: 120, tools_total: 4589, total: 4709 },
    tools: [
      {
        name: 'search_incidents',
        description:
          'Query incidents by service and severity. Returns matching incidents with their current status, severity level, and assigned responder.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"service":{"type":"string","description":"Service name to filter by"},"severity":{"type":"string","enum":["critical","high","medium","low"]},"limit":{"type":"number","default":10}},"required":["service"]}',
        token_estimate: 128,
      },
      {
        name: 'fetch_runbook',
        description: 'Fetch runbook markdown by key',
        type: 'function',
        input_schema_json: '{"type":"object","properties":{"key":{"type":"string"}},"required":["key"]}',
        token_estimate: 32,
      },
      {
        name: 'prometheus_query_handler',
        description:
          'Discover and query Prometheus time-series metrics. Metrics provide quantitative measurements (CPU, memory, request rates, errors). Essential for monitoring and performance analysis.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"datasource_uid":{"type":"string"},"query_type":{"type":"string","enum":["instant","range"]},"operation":{"type":"string"},"metric_patterns":{"type":"array","items":{"type":"string"}},"label_name":{"type":"string"},"start":{"type":"string"},"end":{"type":"string"}},"required":["datasource_uid","operation"]}',
        token_estimate: 1577,
      },
      {
        name: 'create_dashboard',
        description: 'Create a new Grafana dashboard with panels.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"title":{"type":"string"},"panels":{"type":"array"}},"required":["title"]}',
        token_estimate: 137,
      },
      {
        name: 'alerting_manage_rules',
        description: 'Create, update, or delete alerting rules.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"action":{"type":"string","enum":["create","update","delete"]},"rule":{"type":"object"}},"required":["action"]}',
        token_estimate: 563,
      },
      {
        name: 'loki_query_handler',
        description:
          'Query Loki for log data. Supports LogQL queries for filtering, parsing, and aggregating log streams.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"datasource_uid":{"type":"string"},"query":{"type":"string"},"start":{"type":"string"},"end":{"type":"string"},"limit":{"type":"number"}},"required":["datasource_uid","query"]}',
        token_estimate: 1577,
      },
      {
        name: 'grafana_search',
        description: 'Search Grafana dashboards, folders, and alerts.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"query":{"type":"string"},"type":{"type":"string","enum":["dash-db","dash-folder"]}},"required":["query"]}',
        token_estimate: 134,
      },
      {
        name: 'get_entity_health',
        description: 'Get health status of monitored entities.',
        type: 'function',
        input_schema_json:
          '{"type":"object","properties":{"entity_type":{"type":"string"},"entity_id":{"type":"string"}},"required":["entity_type","entity_id"]}',
        token_estimate: 441,
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
  lookupAgentRating: async () => ({
    score: 7,
    summary: 'Persisted latest rating loaded from storage.',
    suggestions: [],
    judge_model: 'openai/gpt-4o-mini',
    judge_latency_ms: 210,
  }),
  rateAgent: async () => ({
    score: 7,
    summary: 'Solid design with room to simplify tool instructions.',
    suggestions: [
      {
        category: 'tools',
        severity: 'medium',
        title: 'Tighten tool parameter docs',
        description: 'Add explicit guidance for when to use optional parameters.',
      },
    ],
    judge_model: 'openai/gpt-4o-mini',
    judge_latency_ms: 320,
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
