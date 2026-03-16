import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { dateTime, type TimeRange } from '@grafana/data';
import { DashboardToolsGrid } from './DashboardToolsGrid';
import type { DashboardDataSource } from '../../dashboard/api';
import type { BreakdownDimension, DashboardFilters, PrometheusQueryResponse } from '../../dashboard/types';

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
    queryInstant: jest.fn().mockImplementation(async (query: string) => {
      if (query.includes('gen_ai_agent_name')) {
        return {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ metric: { gen_ai_agent_name: 'assistant' }, value: [1, '7'] as [number, string] }],
          },
        };
      }

      if (query.includes('gen_ai_tool_name')) {
        return {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ metric: { gen_ai_tool_name: 'calendar.lookup' }, value: [1, '7'] as [number, string] }],
          },
        };
      }

      return {
        status: 'success',
        data: { resultType: 'vector', result: [{ metric: {}, value: [1, '7'] as [number, string] }] },
      };
    }),
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

const timeRange: TimeRange = {
  from: dateTime('2026-03-11T09:00:00Z'),
  to: dateTime('2026-03-11T10:00:00Z'),
  raw: { from: 'now-1h', to: 'now' },
};

const emptyFilters: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

async function renderGrid(dataSource: MockDashboardDataSource, breakdownBy: BreakdownDimension) {
  await act(async () => {
    render(
      <DashboardToolsGrid
        dataSource={dataSource}
        filters={emptyFilters}
        breakdownBy={breakdownBy}
        from={Math.floor(timeRange.from.valueOf() / 1000)}
        to={Math.floor(timeRange.to.valueOf() / 1000)}
        timeRange={timeRange}
        onTimeRangeChange={jest.fn()}
      />
    );
  });
}

describe('DashboardToolsGrid', () => {
  it('links tool breakdown items to tool analytics', async () => {
    const dataSource = createDataSource();

    await renderGrid(dataSource, 'none');

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'calendar.lookup' }).length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('link', { name: 'calendar.lookup' })[0]).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/analytics/tools/calendar.lookup?from=now-1h&to=now'
    );
  });

  it('links agent breakdown items to agent detail', async () => {
    const dataSource = createDataSource();

    await renderGrid(dataSource, 'agent');

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'assistant' }).length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('link', { name: 'assistant' })[0]).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/agents/name/assistant'
    );
  });
});
