import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import AgentsPage from './AgentsPage';
import type { AgentsDataSource } from '../agents/api';
import type { DashboardDataSource } from '../dashboard/api';

type IntersectionObserverCallbackLike = (
  entries: Array<Pick<IntersectionObserverEntry, 'isIntersecting'>>,
  observer: IntersectionObserver
) => void;

const observerCallbacks: IntersectionObserverCallbackLike[] = [];

beforeAll(() => {
  if (typeof globalThis.Request === 'undefined') {
    class RequestMock {
      method: string;

      constructor(_input: unknown, init?: { method?: string }) {
        this.method = String(init?.method ?? 'GET').toUpperCase();
      }
    }
    Object.defineProperty(globalThis, 'Request', {
      writable: true,
      configurable: true,
      value: RequestMock,
    });
  }

  class IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallbackLike) {
      observerCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  }

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: IntersectionObserverMock,
  });

  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      writable: true,
      configurable: true,
      value: ResizeObserverMock,
    });
  }
});

beforeEach(() => {
  observerCallbacks.length = 0;
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-04T12:00:00Z').getTime());
  window.localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function triggerLoadMoreIntersection() {
  for (const callback of observerCallbacks) {
    callback([{ isIntersecting: true }], {} as IntersectionObserver);
  }
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function createDataSource(): AgentsDataSource {
  const agentListResponse = {
    items: [
      {
        agent_name: 'assistant',
        latest_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        latest_declared_version: '1.2.0',
        first_seen_at: '2026-03-04T10:00:00Z',
        latest_seen_at: '2026-03-04T11:00:00Z',
        generation_count: 3,
        version_count: 2,
        tool_count: 1,
        system_prompt_prefix: 'You are concise',
        token_estimate: { system_prompt: 4, tools_total: 5, total: 9 },
      },
      {
        agent_name: '',
        latest_effective_version: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        first_seen_at: '2026-03-04T09:00:00Z',
        latest_seen_at: '2026-03-04T11:00:00Z',
        generation_count: 2,
        version_count: 2,
        tool_count: 0,
        system_prompt_prefix: 'anonymous prompt',
        token_estimate: { system_prompt: 2, tools_total: 0, total: 2 },
      },
    ],
    next_cursor: 'cursor-1',
  };
  const loadMoreResponse = {
    items: [
      {
        agent_name: 'assistant-beta',
        latest_effective_version: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        first_seen_at: '2026-03-04T08:00:00Z',
        latest_seen_at: '2026-03-04T11:10:00Z',
        generation_count: 1,
        version_count: 1,
        tool_count: 2,
        system_prompt_prefix: 'beta prompt',
        token_estimate: { system_prompt: 3, tools_total: 4, total: 7 },
      },
    ],
    next_cursor: '',
  };
  const staleCountResponse = { items: [], next_cursor: '' };

  return {
    listAgents: jest.fn().mockImplementation((_limit, cursor, _namePrefix, seenAfterSec, _seenBeforeSec) => {
      if (seenAfterSec === undefined) {
        return Promise.resolve(staleCountResponse);
      }
      if (cursor === 'cursor-1') {
        return Promise.resolve(loadMoreResponse);
      }
      return Promise.resolve(agentListResponse);
    }),
    lookupAgent: jest.fn(async () => {
      throw new Error('not used in AgentsPage tests');
    }),
    listAgentVersions: jest.fn(async () => ({ items: [], next_cursor: '' })),
    lookupAgentRating: jest.fn(async () => null),
    rateAgent: jest.fn(async () => ({
      score: 8,
      summary: 'Test summary',
      suggestions: [],
      judge_model: 'openai/gpt-4o-mini',
      judge_latency_ms: 100,
    })),
    lookupPromptInsights: jest.fn().mockResolvedValue(null),
    analyzePrompt: jest.fn().mockResolvedValue({
      status: 'completed',
      strengths: [],
      weaknesses: [],
      judge_model: '',
      judge_latency_ms: 0,
    }),
  };
}

function createDashboardDataSource(): DashboardDataSource {
  return {
    queryRange: jest.fn(async () => ({
      status: 'success' as const,
      data: { resultType: 'matrix' as const, result: [] },
    })),
    queryInstant: jest.fn(async () => ({
      status: 'success' as const,
      data: {
        resultType: 'vector' as const,
        result: [
          {
            metric: {
              gen_ai_agent_name: 'assistant',
              gen_ai_provider_name: 'openai',
              gen_ai_request_model: 'gpt-4o-mini',
              gen_ai_token_type: 'input',
            },
            value: [0, '120'] as [number, string],
          },
          {
            metric: {
              gen_ai_agent_name: '',
              gen_ai_provider_name: 'openai',
              gen_ai_request_model: 'gpt-4o-mini',
              gen_ai_token_type: 'input',
            },
            value: [0, '30'] as [number, string],
          },
        ],
      },
    })),
    labels: jest.fn(async () => []),
    labelValues: jest.fn(async () => []),
    resolveModelCards: jest.fn(async () => ({
      resolved: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'resolved' as const,
          match_strategy: 'exact' as const,
          card: {
            model_key: 'openai/gpt-4o-mini',
            source_model_id: 'openai/gpt-4o-mini',
            pricing: {
              prompt_usd_per_token: 0.000001,
              completion_usd_per_token: 0.000002,
              request_usd: null,
              image_usd: null,
              web_search_usd: null,
              input_cache_read_usd_per_token: 0,
              input_cache_write_usd_per_token: 0,
            },
          },
        },
      ],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: '',
      },
    })),
  };
}

describe('AgentsPage', () => {
  function renderPage(
    dataSource: AgentsDataSource,
    dashboardDataSource: DashboardDataSource = createDashboardDataSource()
  ) {
    const router = createMemoryRouter(
      [
        {
          path: '/a/grafana-sigil-app/agents',
          element: (
            <>
              <AgentsPage dataSource={dataSource} dashboardDataSource={dashboardDataSource} />
              <LocationProbe />
            </>
          ),
        },
        {
          path: '/a/grafana-sigil-app/agents/name/:agentName',
          element: <LocationProbe />,
        },
        {
          path: '/a/grafana-sigil-app/agents/anonymous',
          element: <LocationProbe />,
        },
      ],
      {
        initialEntries: ['/a/grafana-sigil-app/agents'],
      }
    );

    return {
      router,
      ...render(<RouterProvider router={router} />),
    };
  }

  it('loads agents and opens named detail route', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));

    fireEvent.click(await screen.findByRole('link', { name: 'open agent assistant' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/a/grafana-sigil-app/agents/name/assistant'));
  });

  it('renders overview TopStats, breakdown panels, and risk signals from loaded agents', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );

    expect(await screen.findByText('Total Generations')).toBeInTheDocument();
    expect(screen.getByText('Total Tokens')).toBeInTheDocument();
    expect(screen.getByText('Estimated Cost')).toBeInTheDocument();

    expect(screen.getByText('Top by Generations')).toBeInTheDocument();
    expect(screen.getByText('Agent Footprint')).toBeInTheDocument();

    const riskStrip = screen.getByRole('status', { name: 'risk signals' });
    expect(within(riskStrip).getByText('anonymous buckets')).toBeInTheDocument();
    expect(within(riskStrip).getByText('1')).toBeInTheDocument();

    expect(screen.getByText('Top Agents')).toBeInTheDocument();
  });

  it('renders the top agents table with correct agent rows', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );

    await screen.findByText('Top Agents');
    const tablePanel = screen.getByText('Top Agents').closest('div')!.parentElement!;
    const agentRows = within(tablePanel)
      .getAllByRole('link')
      .filter((el) => el.tagName === 'TR');
    expect(agentRows).toHaveLength(2);
    expect(agentRows[0]).toHaveTextContent('assistant');
    expect(agentRows[1]).toHaveTextContent('Unnamed agent bucket');
  });

  it('renders risk strip with all-zero signals in neutral styling', async () => {
    const healthyAgentResponse = {
      items: [
        {
          agent_name: 'healthy-agent',
          latest_effective_version: 'sha256:aaaa',
          first_seen_at: '2026-03-04T10:00:00Z',
          latest_seen_at: '2026-03-04T11:00:00Z',
          generation_count: 5,
          version_count: 2,
          tool_count: 1,
          system_prompt_prefix: 'test',
          token_estimate: { system_prompt: 4, tools_total: 5, total: 9 },
        },
      ],
      next_cursor: '',
    };
    const dataSource: AgentsDataSource = {
      ...createDataSource(),
      listAgents: jest.fn().mockImplementation((_limit, _cursor, _namePrefix, seenAfterSec) => {
        if (seenAfterSec === undefined) {
          return Promise.resolve({ items: [], next_cursor: '' });
        }
        return Promise.resolve(healthyAgentResponse);
      }),
    };

    renderPage(dataSource);
    await waitFor(() => expect(dataSource.listAgents).toHaveBeenCalled());
    await screen.findByText('Top by Generations');

    const riskStrip = screen.getByRole('status', { name: 'risk signals' });
    expect(within(riskStrip).getByText('anonymous buckets')).toBeInTheDocument();
    expect(within(riskStrip).getByText('stale (> 7 days)')).toBeInTheDocument();
    expect(within(riskStrip).getByText('high churn (5+ versions)')).toBeInTheDocument();
    const zeroCounts = within(riskStrip).getAllByText('0');
    expect(zeroCounts).toHaveLength(3);
  });

  it('opens anonymous route', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(dataSource);

    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));
    fireEvent.click(await screen.findByRole('link', { name: 'open agent anonymous' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/a/grafana-sigil-app/agents/anonymous'));
  });

  it('auto-loads more when scrolling near the end', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );
    expect(observerCallbacks).toHaveLength(0);
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));
    expect(observerCallbacks.length).toBeGreaterThan(0);

    triggerLoadMoreIntersection();

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, 'cursor-1', '', expect.any(Number), expect.any(Number))
    );
    expect(await screen.findByRole('link', { name: 'open agent assistant-beta' })).toBeInTheDocument();
  });

  it('filters agents by search text', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));

    fireEvent.change(screen.getByPlaceholderText('Search by agent name…'), { target: { value: 'assist' } });

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', 'assist', expect.any(Number), expect.any(Number))
    );
  });

  it('toggles star on an agent and persists to localStorage', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));

    const starButton = await screen.findByRole('button', { name: 'star agent assistant' });
    fireEvent.click(starButton);

    expect(screen.getByRole('button', { name: 'unstar agent assistant' })).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem('sigil.agents.starred') ?? '[]');
    expect(stored).toContain('assistant');

    fireEvent.click(screen.getByRole('button', { name: 'unstar agent assistant' }));
    expect(screen.getByRole('button', { name: 'star agent assistant' })).toBeInTheDocument();

    const storedAfter = JSON.parse(window.localStorage.getItem('sigil.agents.starred') ?? '[]');
    expect(storedAfter).not.toContain('assistant');
  });

  it('sorts starred agents first in the Agents tab table', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));

    const table = screen.getByRole('table', { name: 'agents index table' });
    const rowsBefore = within(table)
      .getAllByRole('link')
      .filter((el) => el.tagName === 'TR');
    expect(rowsBefore[0]).toHaveTextContent('assistant');
    expect(rowsBefore[1]).toHaveTextContent('Unnamed agent bucket');

    const starAnon = within(table).getByRole('button', { name: /star agent Unnamed agent bucket/i });
    fireEvent.click(starAnon);

    const rowsAfter = within(table)
      .getAllByRole('link')
      .filter((el) => el.tagName === 'TR');
    expect(rowsAfter[0]).toHaveTextContent('Unnamed agent bucket');
    expect(rowsAfter[1]).toHaveTextContent('assistant');
  });

  it('shows star buttons in the Top Agents overview table', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() =>
      expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', '', expect.any(Number), expect.any(Number))
    );

    const topAgentsPanel = screen.getByText('Top Agents').closest('div')!.parentElement!;
    const starButtons = within(topAgentsPanel).getAllByRole('button', { name: /star agent/i });
    expect(starButtons.length).toBeGreaterThanOrEqual(2);
  });
});
