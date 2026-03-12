import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import ToolsPage from '../pages/ToolsPage';
import type { DashboardDataSource } from '../dashboard/api';
import type { PrometheusQueryResponse } from '../dashboard/types';

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
  async queryInstant(query) {
    if (query.includes('histogram_quantile')) {
      return makeVectorResponse([
        { labels: { gen_ai_request_model: 'calendar.lookup' }, value: '0.42' },
        { labels: { gen_ai_request_model: 'weather.lookup' }, value: '0.91' },
        { labels: { gen_ai_request_model: 'search.docs' }, value: '1.22' },
      ]);
    }
    if (query.includes('* 100') && query.includes('sum by (gen_ai_request_model)')) {
      return makeVectorResponse([
        { labels: { gen_ai_request_model: 'calendar.lookup' }, value: '4.5' },
        { labels: { gen_ai_request_model: 'weather.lookup' }, value: '1.2' },
        { labels: { gen_ai_request_model: 'search.docs' }, value: '0.8' },
      ]);
    }
    if (query.includes('error_type!=""') && query.includes('sum by (gen_ai_request_model)')) {
      return makeVectorResponse([
        { labels: { gen_ai_request_model: 'calendar.lookup' }, value: '3' },
        { labels: { gen_ai_request_model: 'weather.lookup' }, value: '1' },
        { labels: { gen_ai_request_model: 'search.docs' }, value: '0' },
      ]);
    }
    if (query.includes('sum by (gen_ai_request_model)')) {
      return makeVectorResponse([
        { labels: { gen_ai_request_model: 'calendar.lookup' }, value: '42' },
        { labels: { gen_ai_request_model: 'weather.lookup' }, value: '18' },
        { labels: { gen_ai_request_model: 'search.docs' }, value: '12' },
      ]);
    }
    if (query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '3.8' }]);
    }
    if (query.includes('error_type!=""')) {
      return makeVectorResponse([{ labels: {}, value: '4' }]);
    }
    return makeVectorResponse([{ labels: {}, value: '72' }]);
  },
  async labels() {
    return ['resource.k8s.namespace.name', 'service_name'];
  },
  async labelValues(label) {
    switch (label) {
      case 'gen_ai_provider_name':
        return ['openai'];
      case 'gen_ai_agent_name':
        return ['assistant', 'planner'];
      default:
        return ['prod', 'sigil-api'];
    }
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
  title: 'Pages/ToolsPage',
  component: ToolsPage,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter initialEntries={['/analytics/tools?provider=openai&tool=calendar']}>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export const Default = {
  render: () => <ToolsPage dataSource={mockDataSource} />,
};
