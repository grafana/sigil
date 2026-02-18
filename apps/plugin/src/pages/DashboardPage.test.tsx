import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
      // Fire callback immediately with a reasonable width.
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

describe('DashboardPage', () => {
  it('renders filter bar and panels', async () => {
    const ds = createDataSource();
    await act(async () => {
      render(<DashboardPage dataSource={ds} />);
    });

    expect(screen.getByTestId('time-range-picker')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('panel-Total Operations')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Total Tokens')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Total Errors')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Error Rate')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Estimated Cost')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Unpriced Tokens')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Token Usage Over Time')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Estimated Cost Over Time')).toBeInTheDocument();
      expect(screen.getByTestId('panel-RPS Over Time by Model')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Calls by Provider')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Top Models')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Latency P95')).toBeInTheDocument();
      expect(screen.getByTestId('panel-Time to First Token P95')).toBeInTheDocument();
    });
  });

  it('queries prometheus on mount', async () => {
    const ds = createDataSource();
    await act(async () => {
      render(<DashboardPage dataSource={ds} />);
    });

    await waitFor(() => {
      expect(ds.queryInstant).toHaveBeenCalled();
      expect(ds.queryRange).toHaveBeenCalled();
      expect(ds.labels).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
      expect(ds.labelValues).toHaveBeenCalledWith('gen_ai_provider_name', expect.any(Number), expect.any(Number));
      expect(ds.labelValues).toHaveBeenCalledWith('gen_ai_request_model', expect.any(Number), expect.any(Number));
      expect(ds.labelValues).toHaveBeenCalledWith('gen_ai_agent_name', expect.any(Number), expect.any(Number));
      expect(ds.resolveModelCards).not.toHaveBeenCalled();
    });
  });
});
