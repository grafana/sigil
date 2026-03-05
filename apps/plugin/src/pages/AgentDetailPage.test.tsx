import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AgentDetailPage from './AgentDetailPage';
import type { AgentsDataSource } from '../agents/api';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function createDataSource(): AgentsDataSource {
  return {
    listAgents: jest.fn(async () => ({ items: [], next_cursor: '' })),
    lookupAgentRating: jest.fn(async () => null),
    rateAgent: jest.fn(async () => ({
      score: 8,
      summary: 'Test summary',
      suggestions: [],
      judge_model: 'openai/gpt-4o-mini',
      judge_latency_ms: 100,
    })),
    lookupAgent: jest.fn(async (_name: string, version?: string) => ({
      agent_name: _name,
      effective_version:
        version && version.length > 0
          ? version
          : 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      declared_version_first: '1.0.0',
      declared_version_latest: '1.1.0',
      first_seen_at: '2026-03-04T09:00:00Z',
      last_seen_at: '2026-03-04T11:00:00Z',
      generation_count: 10,
      system_prompt: 'You are concise.',
      system_prompt_prefix: 'You are concise.',
      tool_count: 2,
      token_estimate: { system_prompt: 4, tools_total: 5, total: 9 },
      tools: [
        {
          name: 'weather',
          description: 'Get weather',
          type: 'function',
          input_schema_json: '{"city":{"type":"string"}}',
          token_estimate: 3,
        },
      ],
      models: [
        {
          provider: 'openai',
          name: 'gpt-5',
          generation_count: 10,
          first_seen_at: '2026-03-04T09:00:00Z',
          last_seen_at: '2026-03-04T11:00:00Z',
        },
      ],
    })),
    listAgentVersions: jest.fn(async () => ({
      items: [
        {
          effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          declared_version_first: '1.0.0',
          declared_version_latest: '1.0.0',
          first_seen_at: '2026-03-04T09:00:00Z',
          last_seen_at: '2026-03-04T10:00:00Z',
          generation_count: 4,
          tool_count: 1,
          system_prompt_prefix: 'v1',
          token_estimate: { system_prompt: 4, tools_total: 2, total: 6 },
        },
        {
          effective_version: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          declared_version_first: '1.1.0',
          declared_version_latest: '1.1.0',
          first_seen_at: '2026-03-04T10:00:00Z',
          last_seen_at: '2026-03-04T11:00:00Z',
          generation_count: 6,
          tool_count: 2,
          system_prompt_prefix: 'v2',
          token_estimate: { system_prompt: 5, tools_total: 3, total: 8 },
        },
      ],
      next_cursor: '',
    })),
  };
}

describe('AgentDetailPage', () => {
  it('loads named agent with selected version and updates URL on switch', async () => {
    const dataSource = createDataSource();

    render(
      <MemoryRouter
        initialEntries={[
          '/agents/name/assistant?version=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ]}
      >
        <Routes>
          <Route
            path="/agents/name/:agentName"
            element={
              <>
                <AgentDetailPage dataSource={dataSource} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(dataSource.lookupAgent).toHaveBeenCalledWith(
        'assistant',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )
    );
    await waitFor(() => expect(dataSource.listAgentVersions).toHaveBeenCalledWith('assistant', 50));

    const versionSelector = await screen.findByLabelText('agent version selector');
    fireEvent.keyDown(versionSelector, { key: 'ArrowDown', code: 'ArrowDown' });
    const nextVersionDescription = await screen.findByText('Declared: 1.1.0');
    const nextVersionOption = nextVersionDescription.closest('[role="option"]');
    if (!nextVersionOption) {
      throw new Error('expected to find version option for declared version 1.1.0');
    }
    fireEvent.click(nextVersionOption);

    await waitFor(() => {
      const locationSearch = decodeURIComponent(screen.getByTestId('location-search').textContent ?? '');
      expect(locationSearch).toContain(
        'version=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );
    });
    await waitFor(() =>
      expect(dataSource.lookupAgent).toHaveBeenCalledWith(
        'assistant',
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      )
    );
  });

  it('loads anonymous agent route and renders warning copy', async () => {
    const dataSource = createDataSource();

    render(
      <MemoryRouter initialEntries={['/agents/anonymous']}>
        <Routes>
          <Route path="/agents/anonymous" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(dataSource.lookupAgent).toHaveBeenCalledWith('', undefined));
    expect(await screen.findByText(/aggregates generations where/i)).toBeInTheDocument();
    expect(screen.getByText('gen_ai.agent.name')).toBeInTheDocument();
  });
});
