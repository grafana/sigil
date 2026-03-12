import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ToolAnalyticsPage from './ToolAnalyticsPage';
import type { DashboardDataSource } from '../dashboard/api';
import type { ConversationsDataSource } from '../conversation/api';
import type { PrometheusQueryResponse } from '../dashboard/types';
import type { ConversationSearchResponse } from '../conversation/types';

beforeAll(() => {
  global.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe() {
      this.cb([{ contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    LinkButton: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
    TimeRangePicker: () => <div data-testid="time-range-picker" />,
    PanelChrome: ({
      title,
      children,
    }: {
      title: string;
      children: React.ReactNode | ((w: number, h: number) => React.ReactNode);
    }) => <div data-testid={`panel-${title}`}>{typeof children === 'function' ? children(400, 200) : children}</div>,
  };
});

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PanelRenderer: ({ pluginId }: { pluginId: string }) => <div data-testid={`renderer-${pluginId}`} />,
}));

jest.mock('../components/landing/LandingTopBar', () => ({
  LandingTopBar: () => <div data-testid="landing-top-bar" />,
}));

jest.mock('../hooks/useCascadingFilterOptions', () => ({
  useCascadingFilterOptions: () => ({
    providerOptions: [],
    modelOptions: [],
    agentOptions: [],
    labelKeyOptions: [],
    labelsLoading: false,
  }),
}));

const emptyVector: PrometheusQueryResponse = {
  status: 'success',
  data: { resultType: 'vector', result: [] },
};

const emptyMatrix: PrometheusQueryResponse = {
  status: 'success',
  data: { resultType: 'matrix', result: [] },
};

type MockDashboardDataSource = {
  [Key in keyof DashboardDataSource]: jest.MockedFunction<DashboardDataSource[Key]>;
};

function createDashboardDataSource(): MockDashboardDataSource {
  return {
    queryRange: jest.fn().mockResolvedValue(emptyMatrix),
    queryInstant: jest.fn().mockResolvedValue(emptyVector),
    labels: jest.fn().mockResolvedValue([]),
    labelValues: jest.fn().mockResolvedValue([]),
    resolveModelCards: jest.fn().mockResolvedValue({
      resolved: [],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    }),
  };
}

function createConversationsDataSource(): ConversationsDataSource {
  const searchResponse: ConversationSearchResponse = {
    conversations: [
      {
        conversation_id: 'conv-1',
        conversation_title: 'Calendar helper',
        generation_count: 4,
        first_generation_at: '2026-03-11T09:00:00.000Z',
        last_generation_at: '2026-03-11T09:04:00.000Z',
        models: ['gpt-4o'],
        agents: ['assistant'],
        error_count: 1,
        has_errors: true,
        trace_ids: ['trace-1'],
        annotation_count: 0,
      },
    ],
    has_more: false,
  };

  return {
    searchConversations: jest.fn().mockResolvedValue(searchResponse),
    getConversationDetail: jest.fn(),
    getGeneration: jest.fn(),
    getSearchTags: jest.fn(),
    getSearchTagValues: jest.fn(),
  } as unknown as ConversationsDataSource;
}

describe('ToolAnalyticsPage', () => {
  it('queries execute_tool metrics and builds tool-scoped conversation links', async () => {
    const dataSource = createDashboardDataSource();
    const conversationsDataSource = createConversationsDataSource();

    await act(async () => {
      render(
        <MemoryRouter
          initialEntries={['/analytics/tools/calendar.lookup?provider=openai&label=resource.k8s.namespace.name|=|prod']}
        >
          <Routes>
            <Route
              path="/analytics/tools/:toolName"
              element={<ToolAnalyticsPage dataSource={dataSource} conversationsDataSource={conversationsDataSource} />}
            />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(screen.getByText('calendar.lookup')).toBeInTheDocument();
    expect(screen.getByTestId('landing-top-bar')).toBeInTheDocument();

    await waitFor(() => {
      expect(dataSource.queryInstant).toHaveBeenCalled();
      expect(dataSource.queryRange).toHaveBeenCalled();
      expect(conversationsDataSource.searchConversations).toHaveBeenCalled();
    });

    const metricQueries = dataSource.queryInstant.mock.calls.map((call) => call[0]);
    expect(metricQueries.some((query) => query.includes('gen_ai_operation_name="execute_tool"'))).toBe(true);
    expect(metricQueries.some((query) => query.includes('gen_ai_request_model="calendar.lookup"'))).toBe(true);

    expect(conversationsDataSource.searchConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.stringContaining('tool.name = "calendar.lookup"'),
      })
    );

    expect(
      screen
        .getAllByRole('link', { name: 'Open filtered conversations' })
        .some(
          (link) =>
            link.getAttribute('href') ===
            '/a/grafana-sigil-app/conversations?from=now-1h&to=now&provider=openai&label=resource.k8s.namespace.name%7C%3D%7Cprod&label=tool.name%7C%3D%7Ccalendar.lookup'
        )
    ).toBe(true);

    expect(screen.getByRole('link', { name: 'Back to tools' })).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/analytics/tools?from=now-1h&to=now&provider=openai&label=resource.k8s.namespace.name%7C%3D%7Cprod'
    );
  });

  it('shows the error state when any runtime query fails and no data is available', async () => {
    const dataSource = createDashboardDataSource();
    const conversationsDataSource = createConversationsDataSource();
    dataSource.queryInstant.mockRejectedValueOnce(new Error('prometheus unavailable'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/analytics/tools/calendar.lookup']}>
          <Routes>
            <Route
              path="/analytics/tools/:toolName"
              element={<ToolAnalyticsPage dataSource={dataSource} conversationsDataSource={conversationsDataSource} />}
            />
          </Routes>
        </MemoryRouter>
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Tool analytics failed to load')).toBeInTheDocument();
    });

    expect(
      screen.queryByText('No `execute_tool` runtime data matched calendar.lookup in this time range.')
    ).not.toBeInTheDocument();
  });

  it('does not show the empty state while runtime queries are still loading', async () => {
    const dataSource = createDashboardDataSource();
    const conversationsDataSource = {
      ...createConversationsDataSource(),
      searchConversations: jest.fn(() => new Promise<ConversationSearchResponse>(() => {})),
    } as unknown as ConversationsDataSource;
    const pendingQuery = new Promise<PrometheusQueryResponse>(() => {
      // Keep the page queries in-flight to verify the loading state.
    });
    dataSource.queryInstant.mockReturnValue(pendingQuery);
    dataSource.queryRange.mockReturnValue(pendingQuery);

    render(
      <MemoryRouter initialEntries={['/analytics/tools/calendar.lookup']}>
        <Routes>
          <Route
            path="/analytics/tools/:toolName"
            element={<ToolAnalyticsPage dataSource={dataSource} conversationsDataSource={conversationsDataSource} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.queryByText('No `execute_tool` runtime data matched calendar.lookup in this time range.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Tool analytics failed to load')).not.toBeInTheDocument();
  });
});
