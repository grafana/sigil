import React from 'react';
import { makeTimeRange } from '@grafana/data';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardDataSource } from '../dashboard/api';
import type { PrometheusQueryResponse } from '../dashboard/types';
import { TopToolsPanel } from '../components/dashboard/TopToolsPanel';

function makeVectorResponse(
  results: Array<{ labels: Record<string, string>; value: string }>
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: results.map((result) => ({
        metric: result.labels,
        value: [Date.now() / 1000, result.value] as [number, string],
      })),
    },
  };
}

const mockDataSource: DashboardDataSource = {
  async queryRange() {
    return { status: 'success', data: { resultType: 'matrix', result: [] } };
  },
  async queryInstant() {
    return makeVectorResponse([
      { labels: { gen_ai_request_model: 'calendar.lookup' }, value: '42' },
      { labels: { gen_ai_request_model: 'weather.lookup' }, value: '18' },
      { labels: { gen_ai_request_model: 'search.docs' }, value: '12' },
    ]);
  },
  async labels() {
    return [];
  },
  async labelValues() {
    return [];
  },
  async resolveModelCards() {
    return {
      resolved: [],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
  },
};

export default {
  title: 'Dashboard/TopToolsPanel',
  component: TopToolsPanel,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const Default = {
  render: () => (
    <TopToolsPanel
      dataSource={mockDataSource}
      filters={{
        providers: ['openai'],
        models: [],
        agentNames: ['assistant'],
        labelFilters: [{ key: 'resource.k8s.namespace.name', operator: '=', value: 'prod' }],
      }}
      from={Math.floor(Date.now() / 1000) - 3600}
      to={Math.floor(Date.now() / 1000)}
      timeRange={makeTimeRange('2026-03-11T09:00:00.000Z', '2026-03-11T10:00:00.000Z')}
    />
  ),
};
