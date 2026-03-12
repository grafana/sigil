import React from 'react';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { DashboardConsumptionGrid } from '../components/dashboard/DashboardConsumptionGrid';
import type { DashboardDataSource } from '../dashboard/api';
import type { ConversationsDataSource } from '../conversation/api';
import { emptyFilters, type PrometheusQueryResponse } from '../dashboard/types';

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
const from = now - 3600;
const to = now;
const timePoints = Array.from({ length: 60 }, (_, i) => from + i * 60);

const timeRange: TimeRange = {
  from: dateTimeParse(from * 1000),
  to: dateTimeParse(to * 1000),
  raw: { from: 'now-1h', to: 'now' },
};

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

const mockDataSource: DashboardDataSource = {
  async queryRange(query) {
    if (
      query.includes('gen_ai_token_type') &&
      query.includes('gen_ai_provider_name') &&
      query.includes('gen_ai_request_model')
    ) {
      return makeMatrixResponse([
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
          values: timePoints.map((t) => [t, String(100 + Math.random() * 50)]),
        },
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'output' },
          values: timePoints.map((t) => [t, String(40 + Math.random() * 20)]),
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'input',
          },
          values: timePoints.map((t) => [t, String(60 + Math.random() * 30)]),
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'output',
          },
          values: timePoints.map((t) => [t, String(25 + Math.random() * 10)]),
        },
      ]);
    }
    if (query.includes('gen_ai_token_type')) {
      return makeMatrixResponse([
        {
          labels: { gen_ai_token_type: 'input' },
          values: timePoints.map((t) => [t, String(160 + Math.random() * 80)]),
        },
        {
          labels: { gen_ai_token_type: 'output' },
          values: timePoints.map((t) => [t, String(65 + Math.random() * 30)]),
        },
        {
          labels: { gen_ai_token_type: 'cache_read' },
          values: timePoints.map((t) => [t, String(20 + Math.random() * 15)]),
        },
        {
          labels: { gen_ai_token_type: 'cache_write' },
          values: timePoints.map((t) => [t, String(5 + Math.random() * 5)]),
        },
      ]);
    }
    if (query.includes('token_usage')) {
      return makeMatrixResponse([
        {
          labels: {},
          values: timePoints.map((t) => [t, String(250 + Math.random() * 100)]),
        },
      ]);
    }
    return makeMatrixResponse([]);
  },

  async queryInstant(query) {
    if (query.includes('gen_ai_token_type=~"input"')) {
      return makeVectorResponse([{ labels: {}, value: '482300' }]);
    }
    if (query.includes('gen_ai_token_type=~"output"')) {
      return makeVectorResponse([{ labels: {}, value: '195700' }]);
    }
    if (query.includes('gen_ai_token_type=~"cache_read"')) {
      return makeVectorResponse([{ labels: {}, value: '67400' }]);
    }
    if (query.includes('by (gen_ai_token_type)')) {
      return makeVectorResponse([
        { labels: { gen_ai_token_type: 'input' }, value: '482300' },
        { labels: { gen_ai_token_type: 'output' }, value: '195700' },
        { labels: { gen_ai_token_type: 'cache_read' }, value: '67400' },
        { labels: { gen_ai_token_type: 'cache_write' }, value: '12600' },
      ]);
    }
    if (query.includes('gen_ai_request_model') && query.includes('gen_ai_token_type')) {
      return makeVectorResponse([
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
          value: '300000',
        },
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'output' },
          value: '120000',
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'input',
          },
          value: '182300',
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'output',
          },
          value: '75700',
        },
      ]);
    }
    if (query.includes('token_usage')) {
      return makeVectorResponse([{ labels: {}, value: '758000' }]);
    }
    return makeVectorResponse([{ labels: {}, value: '0' }]);
  },

  async labelValues() {
    return [];
  },
  async labels() {
    return [];
  },
  async resolveModelCards(pairs) {
    return {
      resolved: pairs.map(({ provider, model }) => {
        const key = `${provider.toLowerCase()}:${model}`;
        const resolved = resolvedPricing.get(key);
        if (!resolved) {
          return { provider, model, status: 'unresolved' as const, reason: 'not_found' as const };
        }
        return { provider, model, status: 'resolved' as const, match_strategy: 'exact' as const, card: resolved };
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

const mockConversationsDataSource: ConversationsDataSource = {
  async listConversations() {
    return { items: [] };
  },
  async searchConversations() {
    return {
      conversations: [
        {
          conversation_id: 'conv-1',
          generation_count: 4,
          first_generation_at: '2026-02-01T10:00:00Z',
          last_generation_at: '2026-02-01T10:10:00Z',
          models: ['gpt-4o'],
          agents: ['assistant'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-1'],
          annotation_count: 0,
          conversation_title: 'Order summary follow-up',
          selected: {
            'span.gen_ai.usage.input_tokens': 1200,
            'span.gen_ai.usage.output_tokens': 420,
          },
        },
      ],
      next_cursor: '',
      has_more: false,
    };
  },
  async getConversationDetail() {
    throw new Error('not implemented in DashboardConsumptionGrid story');
  },
  async getGeneration() {
    throw new Error('not implemented in DashboardConsumptionGrid story');
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
  async getConversationStats() {
    return {
      totalConversations: 18,
      totalTokens: 758000,
      avgCallsPerConversation: 4.5,
      activeLast7d: 18,
      ratedConversations: 6,
      badRatedPct: 16.7,
    };
  },
};

const meta = {
  title: 'Dashboard/DashboardConsumptionGrid',
  component: DashboardConsumptionGrid,
};

export default meta;

export const Default = {
  render: () => (
    <DashboardConsumptionGrid
      dataSource={mockDataSource}
      conversationsDataSource={mockConversationsDataSource}
      filters={emptyFilters}
      breakdownBy="none"
      from={from}
      to={to}
      timeRange={timeRange}
      onTimeRangeChange={() => {}}
    />
  ),
};

export const BreakdownByProvider = {
  render: () => (
    <DashboardConsumptionGrid
      dataSource={mockDataSource}
      conversationsDataSource={mockConversationsDataSource}
      filters={emptyFilters}
      breakdownBy="provider"
      from={from}
      to={to}
      timeRange={timeRange}
      onTimeRangeChange={() => {}}
    />
  ),
};
