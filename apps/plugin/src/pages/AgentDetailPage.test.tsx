import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AgentDetailPage from './AgentDetailPage';
import type { AgentsDataSource } from '../agents/api';
import type { AgentRatingResponse } from '../agents/types';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function createDataSource(): AgentsDataSource {
  return {
    listAgents: jest.fn(async () => ({ items: [], next_cursor: '' })),
    lookupAgentRating: jest.fn(async () => ({
      status: 'completed' as const,
      score: 8,
      summary: 'Top-line report summary.\nSecond line details.',
      suggestions: [],
      judge_model: 'openai/gpt-4o-mini',
      judge_latency_ms: 88,
    })),
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

    fireEvent.click(await screen.findByLabelText('toggle agent version selector'));
    const nextVersionDescription = await screen.findByText('Declared: 1.1.0');
    const nextVersionOption = nextVersionDescription.closest('button');
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

  it('hides recent versions when only one version exists', async () => {
    const dataSource = createDataSource();
    dataSource.listAgentVersions = jest.fn(async () => ({
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
      ],
      next_cursor: '',
    }));

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByLabelText('toggle agent version selector')).toBeInTheDocument();
    expect(screen.queryByLabelText('agent version selector')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent versions')).not.toBeInTheDocument();
  });

  it('shows up to eight recent versions in the top bar', async () => {
    const dataSource = createDataSource();
    dataSource.listAgentVersions = jest.fn(async () => ({
      items: Array.from({ length: 12 }, (_, index) => {
        const versionDigit = ((index % 9) + 1).toString();
        const effectiveVersion = `sha256:${versionDigit.repeat(64)}`;
        const hour = (index + 1).toString().padStart(2, '0');
        return {
          effective_version: effectiveVersion,
          declared_version_first: `${index + 1}.0.0`,
          declared_version_latest: `${index + 1}.0.0`,
          first_seen_at: `2026-03-04T${hour}:00:00Z`,
          last_seen_at: `2026-03-04T${hour}:30:00Z`,
          generation_count: index + 1,
          tool_count: 1,
          system_prompt_prefix: `v${index + 1}`,
          token_estimate: { system_prompt: 4, tools_total: 2, total: 6 },
        };
      }),
      next_cursor: '',
    }));

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByLabelText('toggle agent version selector');
    await waitFor(() => {
      expect(screen.getAllByLabelText(/select version sha256:/i)).toHaveLength(8);
    });
  });

  it('does not show rating error alert when latest rating returns 404', async () => {
    const dataSource = createDataSource();
    dataSource.lookupAgentRating = jest.fn(async () => {
      throw { status: 404, data: { message: 'not found' } };
    });

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(dataSource.lookupAgentRating).toHaveBeenCalled());
    expect(screen.queryByText('Agent rating failed')).not.toBeInTheDocument();
  });

  it('shows latest rating badge on hero card with first-line summary text', async () => {
    const dataSource = createDataSource();

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByLabelText('toggle agent version selector');
    expect(screen.queryByText('LATEST SCORE')).not.toBeInTheDocument();
    expect(screen.getAllByText('8/10').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Latest score 8/10')).toBeInTheDocument();
  });

  it('shows compact age in top stats', async () => {
    const dataSource = createDataSource();

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('AGE')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('switches between Prompts and Tools main tabs', async () => {
    const dataSource = createDataSource();

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('System prompt and context analysis')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'select tool weather' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));

    expect(await screen.findByRole('button', { name: 'select tool weather' })).toBeInTheDocument();
    expect(screen.queryByText('System prompt and context analysis')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));

    expect(await screen.findByText('System prompt and context analysis')).toBeInTheDocument();
  });

  it('shows info icons for all top stats', async () => {
    const dataSource = createDataSource();

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('AGE')).toBeInTheDocument();
    const staticStatLabels = ['AGE', 'FIRST SEEN', 'LAST SEEN'];
    for (const label of staticStatLabels) {
      expect(screen.getByLabelText(`${label} help`)).toBeInTheDocument();
    }

    const promptStatLabels = ['GENERATIONS', 'PROMPT TOKENS', 'TOTAL TOKENS'];
    for (const label of promptStatLabels) {
      expect(screen.getByLabelText(`${label} help`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    expect(await screen.findByText('TOOLS TOKENS')).toBeInTheDocument();
    expect(screen.getByLabelText('TOOLS TOKENS help')).toBeInTheDocument();
  });

  it('defaults to markdown and keeps markdown when tokenize is enabled', async () => {
    const dataSource = createDataSource();
    const lookupAgent = dataSource.lookupAgent;
    const lookupAgentRating = dataSource.lookupAgentRating;
    dataSource.lookupAgent = jest.fn(async (name: string, version?: string) => {
      const detail = await lookupAgent(name, version);
      return {
        ...detail,
        system_prompt: '# Prompt heading\n\nUse **bold** and [Docs](https://grafana.com/docs).\n\n- First bullet',
        system_prompt_prefix: '# Prompt heading',
      };
    });
    dataSource.lookupAgentRating = jest.fn(async (name: string, version?: string) => {
      const rating = await lookupAgentRating(name, version);
      const nextRating: AgentRatingResponse = {
        ...rating,
        status: 'completed' as const,
        score: 8,
        summary: 'Summary with **emphasis**.',
        suggestions: [
          {
            severity: 'medium',
            category: 'clarity',
            title: 'Use clearer constraints',
            description: 'Add **strict constraints** for tool execution.',
          },
        ],
        judge_model: 'openai/gpt-4o-mini',
        judge_latency_ms: 88,
      };
      return nextRating;
    });

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/# Prompt heading/)).toBeInTheDocument();
    expect(screen.getByText(/- First bullet/)).toBeInTheDocument();
    expect(screen.getByText(/\*\*strict constraints\*\*/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('Prompt heading')).toBeInTheDocument();
    expect(screen.queryByText('# Prompt heading')).not.toBeInTheDocument();
    expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://grafana.com/docs');
    expect(screen.getByText('strict constraints', { selector: 'strong' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));

    expect(await screen.findByText(/# Prompt heading/)).toBeInTheDocument();
    expect(screen.getByText(/- First bullet/)).toBeInTheDocument();
    expect(screen.getByText(/\*\*strict constraints\*\*/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Tokenize' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByText(/# Prompt heading/)).toBeInTheDocument();
    expect(screen.queryByText('Prompt heading')).not.toBeInTheDocument();
  });

  it('does not retry recent version ratings forever after lookup failures', async () => {
    const dataSource = createDataSource();
    dataSource.lookupAgentRating = jest.fn(async (_name: string, version?: string) => {
      if (version && version.length > 0) {
        throw new Error('boom');
      }
      return {
        status: 'completed' as const,
        score: 8,
        summary: 'Top-line report summary.\nSecond line details.',
        suggestions: [],
        judge_model: 'openai/gpt-4o-mini',
        judge_latency_ms: 88,
      };
    });

    render(
      <MemoryRouter initialEntries={['/agents/name/assistant']}>
        <Routes>
          <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const versionedCalls = (dataSource.lookupAgentRating as jest.Mock).mock.calls.filter(([, version]) =>
        Boolean(version)
      );
      expect(versionedCalls).toHaveLength(2);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const versionedCalls = (dataSource.lookupAgentRating as jest.Mock).mock.calls.filter(([, version]) =>
      Boolean(version)
    );
    expect(versionedCalls).toHaveLength(2);
  });

  it('scrolls to system prompt and context analysis when re-running analysis', async () => {
    const dataSource = createDataSource();
    const scrollIntoViewSpy = jest.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    try {
      render(
        <MemoryRouter initialEntries={['/agents/name/assistant']}>
          <Routes>
            <Route path="/agents/name/:agentName" element={<AgentDetailPage dataSource={dataSource} />} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.click(await screen.findByRole('button', { name: /re-run/i }));

      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
