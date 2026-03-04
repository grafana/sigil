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
  return {
    listAgents: jest
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
      }),
    lookupAgent: jest.fn(async () => {
      throw new Error('not used in AgentsPage tests');
    }),
    listAgentVersions: jest.fn(async () => ({ items: [], next_cursor: '' })),
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

    await waitFor(() => expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', ''));
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));

    fireEvent.click(await screen.findByRole('button', { name: 'open agent assistant' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/a/grafana-sigil-app/agents/name/assistant'));
  });

  it('renders hero KPIs, rankings, and risk counts from loaded agents', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    const heroRegion = await screen.findByRole('region', { name: 'agents hero summary' });
    expect(heroRegion).toBeInTheDocument();
    expect(within(heroRegion).getByText('Agents')).toBeInTheDocument();
    expect(within(heroRegion).getByText('Total generations')).toBeInTheDocument();
    expect(within(heroRegion).getAllByText('Token usage')).toHaveLength(1);
    expect(within(heroRegion).getByText('Agent footprint')).toBeInTheDocument();
    expect(within(heroRegion).getByText('Avg usage per generation')).toBeInTheDocument();
    // Only the first page is loaded in this test (2 agents): generations=5, runtime tokens=150, avg=30
    expect(within(heroRegion).getByText('Agents').parentElement).toHaveTextContent('2');
    expect(within(heroRegion).getByText('Total generations').parentElement).toHaveTextContent('5');
    expect(within(heroRegion).getByLabelText('Total runtime token usage')).toHaveTextContent('150 tokens');
    expect(within(heroRegion).getByText('Avg usage per generation').parentElement).toHaveTextContent('30');

    const topByGenerationsSection = screen.getByText('Top by generations').closest('div');
    expect(topByGenerationsSection).toBeTruthy();
    const generationButtons = within(topByGenerationsSection as HTMLElement).getAllByRole('button');
    expect(generationButtons.map((button) => button.textContent)).toEqual(['assistant', 'Unnamed agent bucket']);

    const topByTokenHeading = within(heroRegion).getByText('Agent footprint');
    const topByTokenSection = topByTokenHeading.closest('div')?.parentElement;
    expect(topByTokenSection).toBeTruthy();
    const tokenButtons = within(topByTokenSection as HTMLElement).getAllByRole('button');
    expect(tokenButtons.map((button) => button.textContent)).toEqual(['assistant', 'Unnamed agent bucket']);

    expect(screen.getByText('anonymous buckets').parentElement).toHaveTextContent('1');
    expect(screen.getByText('stale (> 7 days)').parentElement).toHaveTextContent('0');
    expect(screen.getByText('high churn (5+ versions)').parentElement).toHaveTextContent('0');
  });

  it('keeps runtime usage KPIs based on agents with runtime metrics after loading more', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() => expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', ''));
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));
    triggerLoadMoreIntersection();
    await waitFor(() => expect(dataSource.listAgents).toHaveBeenNthCalledWith(2, 24, 'cursor-1', ''));

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));

    const heroRegion = await screen.findByRole('region', { name: 'agents hero summary' });
    expect(within(heroRegion).getByText('Total generations').parentElement).toHaveTextContent('5');
    expect(within(heroRegion).getByLabelText('Total runtime token usage')).toHaveTextContent('150 tokens');
    expect(within(heroRegion).getByText('Avg usage per generation').parentElement).toHaveTextContent('30');
  });

  it('opens anonymous route', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(dataSource);

    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));
    fireEvent.click(await screen.findByRole('button', { name: 'open agent anonymous' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/a/grafana-sigil-app/agents/anonymous'));
  });

  it('auto-loads more when scrolling near the end', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() => expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', ''));
    expect(observerCallbacks).toHaveLength(0);
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));
    expect(observerCallbacks.length).toBeGreaterThan(0);

    triggerLoadMoreIntersection();

    await waitFor(() => expect(dataSource.listAgents).toHaveBeenNthCalledWith(2, 24, 'cursor-1', ''));
    expect(await screen.findByRole('button', { name: 'open agent assistant-beta' })).toBeInTheDocument();
  });

  it('filters agents by search text', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    await waitFor(() => expect(dataSource.listAgents).toHaveBeenCalledWith(24, '', ''));
    fireEvent.click(await screen.findByRole('tab', { name: 'Agents' }));

    fireEvent.change(screen.getByPlaceholderText('Search by agent name…'), { target: { value: 'assist' } });

    await waitFor(() => expect(dataSource.listAgents).toHaveBeenLastCalledWith(24, '', 'assist'));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => expect(screen.getByText('Total generations').parentElement).toHaveTextContent('0'));
    expect(screen.getByRole('button', { name: 'open top generation agent assistant-beta' })).toBeInTheDocument();
  });

  it('shows sub-cent USD precision for tiny footprint values', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource);

    const modeSelect = await screen.findByLabelText('Top prompt and tools display mode');
    fireEvent.change(modeSelect, { target: { value: 'usd' } });

    await waitFor(() => {
      const anonymousTopTokenButton = screen.getByRole('button', { name: 'open top token agent anonymous' });
      const anonymousListItem = anonymousTopTokenButton.closest('li');
      expect(anonymousListItem).toHaveTextContent('$0.000030');
      expect(anonymousListItem).not.toHaveTextContent('$0.000000');
    });
  });
});
