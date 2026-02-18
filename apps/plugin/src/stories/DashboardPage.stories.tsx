import React from 'react';
import DashboardPage from '../pages/DashboardPage';
import type { DashboardDataSource } from '../dashboard/api';
import type { PrometheusQueryResponse } from '../dashboard/types';

const resolvedPricing = new Map([
  [
    'openai:gpt-4o',
    {
      model_key: 'openrouter:openai/gpt-4o',
      source_model_id: 'openai/gpt-4o',
      pricing: {
        prompt_usd_per_token: 0.0025,
        completion_usd_per_token: 0.01,
        request_usd: null,
        image_usd: null,
        web_search_usd: null,
        input_cache_read_usd_per_token: 0.00125,
        input_cache_write_usd_per_token: 0.00375,
      },
    },
  ],
  [
    'anthropic:claude-sonnet-4-20250514',
    {
      model_key: 'openrouter:anthropic/claude-sonnet-4-20250514',
      source_model_id: 'anthropic/claude-sonnet-4-20250514',
      pricing: {
        prompt_usd_per_token: 0.003,
        completion_usd_per_token: 0.015,
        request_usd: null,
        image_usd: null,
        web_search_usd: null,
        input_cache_read_usd_per_token: 0.0003,
        input_cache_write_usd_per_token: 0.00375,
      },
    },
  ],
]);

function makeMatrixResponse(
  series: Array<{ labels: Record<string, string>; values: Array<[number, string]> }>
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: series.map((s) => ({ metric: s.labels, values: s.values })),
    },
  };
}

function makeVectorResponse(
  results: Array<{ labels: Record<string, string>; value: string }>
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: results.map((r) => ({ metric: r.labels, value: [Date.now() / 1000, r.value] as [number, string] })),
    },
  };
}

const now = Math.floor(Date.now() / 1000);
const timePoints = Array.from({ length: 60 }, (_, i) => now - 3600 + i * 60);

const mockDataSource: DashboardDataSource = {
  async queryRange(query) {
    // Return mock timeseries based on query pattern
    if (
      query.includes('token_usage') &&
      query.includes('gen_ai_provider_name') &&
      query.includes('gen_ai_request_model')
    ) {
      return makeMatrixResponse([
        {
          labels: {
            gen_ai_provider_name: 'openai',
            gen_ai_request_model: 'gpt-4o',
            gen_ai_token_type: 'input',
          },
          values: timePoints.map((t) => [t, String(100 + Math.random() * 50)]),
        },
        {
          labels: {
            gen_ai_provider_name: 'openai',
            gen_ai_request_model: 'gpt-4o',
            gen_ai_token_type: 'output',
          },
          values: timePoints.map((t) => [t, String(40 + Math.random() * 20)]),
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'input',
          },
          values: timePoints.map((t) => [t, String(35 + Math.random() * 15)]),
        },
      ]);
    }
    if (query.includes('token_usage')) {
      return makeMatrixResponse([
        {
          labels: { gen_ai_token_type: 'input' },
          values: timePoints.map((t) => [t, String(100 + Math.random() * 50)]),
        },
        {
          labels: { gen_ai_token_type: 'output' },
          values: timePoints.map((t) => [t, String(40 + Math.random() * 20)]),
        },
        {
          labels: { gen_ai_token_type: 'cache_read' },
          values: timePoints.map((t) => [t, String(10 + Math.random() * 5)]),
        },
      ]);
    }
    if (query.includes('operation_duration_seconds_bucket')) {
      return makeMatrixResponse([
        {
          labels: {},
          values: timePoints.map((t) => [t, String(0.3 + Math.random() * 0.2)]),
        },
      ]);
    }
    if (query.includes('operation_duration_seconds_count') && query.includes('gen_ai_request_model')) {
      return makeMatrixResponse([
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o' },
          values: timePoints.map((t) => [t, String(1.8 + Math.random() * 0.4)]),
        },
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o-mini' },
          values: timePoints.map((t) => [t, String(1.1 + Math.random() * 0.3)]),
        },
        {
          labels: { gen_ai_provider_name: 'anthropic', gen_ai_request_model: 'claude-sonnet-4-20250514' },
          values: timePoints.map((t) => [t, String(0.8 + Math.random() * 0.2)]),
        },
      ]);
    }
    if (query.includes('time_to_first_token_seconds')) {
      return makeMatrixResponse([
        {
          labels: {},
          values: timePoints.map((t) => [t, String(0.05 + Math.random() * 0.03)]),
        },
      ]);
    }
    return makeMatrixResponse([]);
  },

  async queryInstant(query) {
    if (query.includes('error_type') && query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '2.3' }]);
    }
    if (query.includes('error_type')) {
      return makeVectorResponse([{ labels: {}, value: '15' }]);
    }
    if (query.includes('token_usage') && query.includes('gen_ai_request_model')) {
      return makeVectorResponse([
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
          value: '50000',
        },
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'output' },
          value: '20000',
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'input',
          },
          value: '30000',
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'output',
          },
          value: '15000',
        },
      ]);
    }
    if (query.includes('token_usage')) {
      return makeVectorResponse([{ labels: {}, value: '115000' }]);
    }
    if (query.includes('gen_ai_provider_name') && query.includes('gen_ai_request_model')) {
      return makeVectorResponse([
        { labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o' }, value: '350' },
        {
          labels: { gen_ai_provider_name: 'anthropic', gen_ai_request_model: 'claude-sonnet-4-20250514' },
          value: '200',
        },
        { labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o-mini' }, value: '100' },
      ]);
    }
    if (query.includes('gen_ai_provider_name')) {
      return makeVectorResponse([
        { labels: { gen_ai_provider_name: 'openai' }, value: '420' },
        { labels: { gen_ai_provider_name: 'anthropic' }, value: '230' },
      ]);
    }
    if (query.includes('gen_ai_request_model')) {
      return makeVectorResponse([
        { labels: { gen_ai_request_model: 'gpt-4o' }, value: '350' },
        { labels: { gen_ai_request_model: 'claude-sonnet-4-20250514' }, value: '200' },
        { labels: { gen_ai_request_model: 'gpt-4o-mini' }, value: '100' },
      ]);
    }
    return makeVectorResponse([{ labels: {}, value: '650' }]);
  },

  async labelValues(label) {
    switch (label) {
      case 'gen_ai_provider_name':
        return ['openai', 'anthropic'];
      case 'gen_ai_request_model':
        return ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-20250514'];
      case 'gen_ai_agent_name':
        return ['my-chatbot', 'code-assistant', 'data-analyzer'];
      default:
        return [];
    }
  },

  async labels() {
    return [
      'gen_ai_provider_name',
      'gen_ai_request_model',
      'gen_ai_agent_name',
      'gen_ai_operation_name',
      'gen_ai_token_type',
      'job',
    ];
  },

  async resolveModelCards(pairs) {
    return {
      resolved: pairs.map(({ provider, model }) => {
        const resolvedCard = resolvedPricing.get(`${provider.toLowerCase()}:${model}`);
        if (!resolvedCard) {
          return {
            provider,
            model,
            status: 'unresolved' as const,
            reason: 'not_found' as const,
          };
        }
        return {
          provider,
          model,
          status: 'resolved' as const,
          match_strategy: 'exact' as const,
          card: resolvedCard,
        };
      }),
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
  title: 'Pages/DashboardPage',
  component: DashboardPage,
};

export const Default = {
  render: () => <DashboardPage dataSource={mockDataSource} />,
};
