import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import type { DashboardDataSource } from '../dashboard/api';
import type { PrometheusQueryResponse } from '../dashboard/types';

// ResizeObserver is not available in JSDOM.
beforeAll(() => {
  global.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
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
    Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
    LinkButton: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
    TimeRangePicker: () => <div data-testid="time-range-picker" />,
    TimeRangeInput: (props: { value: unknown; onChange: unknown }) => <div data-testid="time-range-input" />,
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

jest.mock('@grafana/assistant', () => ({
  useInlineAssistant: () => ({
    isGenerating: false,
    content: '',
    generate: jest.fn(),
  }),
  useAssistant: () => ({
    openAssistant: jest.fn(),
  }),
}));

jest.mock('../components/landing/LandingTopBar', () => ({
  LandingTopBar: () => <div data-testid="landing-top-bar" />,
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

function createDataSource(): MockDashboardDataSource {
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

function renderWithRouter(ds: MockDashboardDataSource, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DashboardPage dataSource={ds} />
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  it('renders filter bar and paired metric rows', async () => {
    const ds = createDataSource();
    await act(async () => {
      renderWithRouter(ds);
    });

    expect(screen.getByTestId('time-range-picker')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByTestId('renderer-timeseries')).toHaveLength(5);
    });
  });

  it('queries prometheus on mount', async () => {
    const ds = createDataSource();
    await act(async () => {
      renderWithRouter(ds);
    });

    await waitFor(() => {
      expect(ds.queryInstant).toHaveBeenCalled();
      expect(ds.queryRange).toHaveBeenCalled();
      expect(ds.labels).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
      expect(ds.labelValues).toHaveBeenCalledWith(
        'gen_ai_provider_name',
        expect.any(Number),
        expect.any(Number),
        undefined
      );
      expect(ds.labelValues).toHaveBeenCalledWith(
        'gen_ai_request_model',
        expect.any(Number),
        expect.any(Number),
        undefined
      );
      expect(ds.labelValues).toHaveBeenCalledWith(
        'gen_ai_agent_name',
        expect.any(Number),
        expect.any(Number),
        undefined
      );
      expect(ds.resolveModelCards).not.toHaveBeenCalled();
    });
  });

  it('applies provider filter from URL params', async () => {
    const ds = createDataSource();
    await act(async () => {
      renderWithRouter(ds, '/?provider=openai');
    });

    await waitFor(() => {
      const calls = ds.queryInstant.mock.calls;
      const hasProviderFilter = calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('gen_ai_provider_name')
      );
      expect(hasProviderFilter).toBe(true);
    });
  });

  it('applies breakdown from URL params', async () => {
    const ds = createDataSource();
    await act(async () => {
      renderWithRouter(ds, '/?breakdownBy=model');
    });

    await waitFor(() => {
      const calls = ds.queryRange.mock.calls;
      const hasModelBreakdown = calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('gen_ai_request_model')
      );
      expect(hasModelBreakdown).toBe(true);
    });
  });
});
