import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { makeTimeRange } from '@grafana/data';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardDataSource } from '../../dashboard/api';
import type { PrometheusQueryResponse } from '../../dashboard/types';
import { TopToolsPanel } from './TopToolsPanel';

const vectorResponse: PrometheusQueryResponse = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [
      { metric: { gen_ai_request_model: 'calendar.lookup' }, value: [1, '42'] },
      { metric: { gen_ai_request_model: 'weather.lookup' }, value: [1, '12'] },
    ],
  },
};

function createDataSource(): DashboardDataSource {
  return {
    queryRange: jest.fn(),
    queryInstant: jest.fn().mockResolvedValue(vectorResponse),
    labels: jest.fn(),
    labelValues: jest.fn(),
    resolveModelCards: jest.fn(),
  } as unknown as DashboardDataSource;
}

describe('TopToolsPanel', () => {
  it('links tool rows to the analytics drilldown while preserving filters', async () => {
    const dataSource = createDataSource();
    render(
      <MemoryRouter>
        <TopToolsPanel
          dataSource={dataSource}
          filters={{
            providers: ['openai'],
            models: [],
            agentNames: ['assistant'],
            labelFilters: [{ key: 'resource.k8s.namespace.name', operator: '=', value: 'prod' }],
          }}
          from={100}
          to={460}
          timeRange={makeTimeRange('2026-03-11T09:00:00.000Z', '2026-03-11T10:00:00.000Z')}
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'calendar.lookup' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'calendar.lookup' })).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/analytics/tools/calendar.lookup?from=2026-03-11T09%3A00%3A00.000Z&to=2026-03-11T10%3A00%3A00.000Z&provider=openai&agent=assistant&label=resource.k8s.namespace.name%7C%3D%7Cprod'
    );
  });
});
