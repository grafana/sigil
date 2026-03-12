import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ToolsPage from './ToolsPage';
import type { DashboardDataSource } from '../dashboard/api';
import type { PrometheusQueryResponse } from '../dashboard/types';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    TimeRangePicker: () => <div data-testid="time-range-picker" />,
  };
});

jest.mock('../components/landing/LandingTopBar', () => ({
  LandingTopBar: () => <div data-testid="landing-top-bar" />,
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
      if (query.includes('histogram_quantile')) {
        return {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { gen_ai_request_model: 'calendar.lookup' }, value: [1, '0.42'] as [number, string] },
              { metric: { gen_ai_request_model: 'weather.lookup' }, value: [1, '0.88'] as [number, string] },
            ],
          },
        };
      }
      if (query.includes('* 100') && query.includes('sum by (gen_ai_request_model)')) {
        return {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { gen_ai_request_model: 'calendar.lookup' }, value: [1, '4.5'] as [number, string] },
              { metric: { gen_ai_request_model: 'weather.lookup' }, value: [1, '1.2'] as [number, string] },
            ],
          },
        };
      }
      if (query.includes('error_type!=""') && query.includes('sum by (gen_ai_request_model)')) {
        return {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { gen_ai_request_model: 'calendar.lookup' }, value: [1, '3'] as [number, string] },
              { metric: { gen_ai_request_model: 'weather.lookup' }, value: [1, '1'] as [number, string] },
            ],
          },
        };
      }
      if (query.includes('sum by (gen_ai_request_model)')) {
        return {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { gen_ai_request_model: 'calendar.lookup' }, value: [1, '42'] as [number, string] },
              { metric: { gen_ai_request_model: 'weather.lookup' }, value: [1, '18'] as [number, string] },
            ],
          },
        };
      }
      if (query.includes('* 100')) {
        return { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1, '3.8'] }] } };
      }
      if (query.includes('error_type!=""')) {
        return { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1, '4'] }] } };
      }
      return { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1, '60'] }] } };
    }),
    labels: jest.fn().mockResolvedValue(['service_name']),
    labelValues: jest.fn().mockResolvedValue(['openai', 'assistant']),
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

describe('ToolsPage', () => {
  it('queries execute_tool metrics and renders drilldown links filtered by tool name', async () => {
    const dataSource = createDataSource();

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/analytics/tools?provider=openai&tool=calendar']}>
          <ToolsPage dataSource={dataSource} />
        </MemoryRouter>
      );
    });

    expect(screen.getByTestId('landing-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('time-range-picker')).toBeInTheDocument();

    await waitFor(() => {
      expect(dataSource.queryInstant).toHaveBeenCalled();
    });

    const queries = dataSource.queryInstant.mock.calls.map((call) => call[0]);
    expect(queries.some((query) => query.includes('gen_ai_operation_name="execute_tool"'))).toBe(true);

    const toolLink = screen.getByRole('link', { name: 'calendar.lookup' });
    expect(toolLink).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/analytics/tools/calendar.lookup?from=now-1h&to=now&provider=openai'
    );
    expect(screen.queryByRole('link', { name: 'weather.lookup' })).not.toBeInTheDocument();
  });

  it('shows the page error state when all tool queries fail', async () => {
    const dataSource = createDataSource();
    dataSource.queryInstant.mockRejectedValue(new Error('prometheus unavailable'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/analytics/tools']}>
          <ToolsPage dataSource={dataSource} />
        </MemoryRouter>
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Tools analytics failed to load')).toBeInTheDocument();
    });
  });
});
