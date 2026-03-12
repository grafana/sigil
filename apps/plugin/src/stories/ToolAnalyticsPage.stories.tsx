import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ToolAnalyticsPage from '../pages/ToolAnalyticsPage';
import type { DashboardDataSource } from '../dashboard/api';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResponse } from '../conversation/types';
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

function makeMatrixResponse(
  series: Array<{ labels: Record<string, string>; values: Array<[number, string]> }>
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: series.map((item) => ({ metric: item.labels, values: item.values })),
    },
  };
}

const now = Math.floor(Date.now() / 1000);
const timePoints = Array.from({ length: 30 }, (_, index) => now - 1800 + index * 60);

const mockDataSource: DashboardDataSource = {
  async queryRange(query) {
    if (query.includes('histogram_quantile(0.5')) {
      return makeMatrixResponse([{ labels: {}, values: timePoints.map((time) => [time, '0.12']) }]);
    }
    if (query.includes('histogram_quantile(0.95')) {
      return makeMatrixResponse([{ labels: {}, values: timePoints.map((time) => [time, '0.48']) }]);
    }
    if (query.includes('histogram_quantile(0.99')) {
      return makeMatrixResponse([{ labels: {}, values: timePoints.map((time) => [time, '0.71']) }]);
    }
    if (query.includes('* 100')) {
      return makeMatrixResponse([{ labels: {}, values: timePoints.map((time) => [time, '3.2']) }]);
    }
    return makeMatrixResponse([{ labels: {}, values: timePoints.map((time) => [time, '12']) }]);
  },
  async queryInstant(query) {
    if (query.includes('error_type') && query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '3.2' }]);
    }
    if (query.includes('error_type') && query.includes('sum by (error_type)')) {
      return makeVectorResponse([
        { labels: { error_type: 'tool_execution_error' }, value: '5' },
        { labels: { error_type: 'timeout' }, value: '2' },
      ]);
    }
    if (query.includes('sum by (gen_ai_agent_name)')) {
      return makeVectorResponse([
        { labels: { gen_ai_agent_name: 'assistant' }, value: '18' },
        { labels: { gen_ai_agent_name: 'planner' }, value: '11' },
      ]);
    }
    if (query.includes('histogram_quantile(0.5')) {
      return makeVectorResponse([{ labels: {}, value: '0.12' }]);
    }
    if (query.includes('histogram_quantile(0.95')) {
      return makeVectorResponse([{ labels: {}, value: '0.48' }]);
    }
    if (query.includes('histogram_quantile(0.99')) {
      return makeVectorResponse([{ labels: {}, value: '0.71' }]);
    }
    if (query.includes('error_type')) {
      return makeVectorResponse([{ labels: {}, value: '7' }]);
    }
    return makeVectorResponse([{ labels: {}, value: '29' }]);
  },
  async labels() {
    return ['resource.k8s.namespace.name', 'service_name'];
  },
  async labelValues(label) {
    switch (label) {
      case 'gen_ai_provider_name':
        return ['openai'];
      case 'gen_ai_request_model':
        return ['gpt-4o'];
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

const conversationsDataSource: ConversationsDataSource = {
  async searchConversations() {
    const response: ConversationSearchResponse = {
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
    return response;
  },
  async getConversationDetail() {
    throw new Error('not implemented');
  },
  async getGeneration() {
    throw new Error('not implemented');
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
};

export default {
  title: 'Pages/ToolAnalyticsPage',
  component: ToolAnalyticsPage,
};

export const Default = {
  render: () => (
    <MemoryRouter initialEntries={['/analytics/tools/calendar.lookup?provider=openai']}>
      <Routes>
        <Route
          path="/analytics/tools/:toolName"
          element={<ToolAnalyticsPage dataSource={mockDataSource} conversationsDataSource={conversationsDataSource} />}
        />
      </Routes>
    </MemoryRouter>
  ),
};
