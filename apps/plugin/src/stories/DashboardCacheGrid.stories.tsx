import React from 'react';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { DashboardCacheGrid } from '../components/dashboard/DashboardCacheGrid';
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
    // Cache hit rate over time
    if (query.includes('cache_read') && query.includes('input') && query.includes('* 100')) {
      return makeMatrixResponse([
        {
          labels: {},
          values: timePoints.map((t) => [t, String(10 + Math.random() * 20)]),
        },
      ]);
    }
    // Cache read vs write over time
    if (query.includes('cache_read|cache_write')) {
      return makeMatrixResponse([
        {
          labels: { gen_ai_token_type: 'cache_read' },
          values: timePoints.map((t) => [t, String(40 + Math.random() * 25)]),
        },
        {
          labels: { gen_ai_token_type: 'cache_write' },
          values: timePoints.map((t) => [t, String(8 + Math.random() * 6)]),
        },
      ]);
    }
    // Cache read by breakdown
    if (query.includes('cache_read') && query.includes('gen_ai_provider_name')) {
      return makeMatrixResponse([
        {
          labels: { gen_ai_provider_name: 'openai' },
          values: timePoints.map((t) => [t, String(25 + Math.random() * 15)]),
        },
        {
          labels: { gen_ai_provider_name: 'anthropic' },
          values: timePoints.map((t) => [t, String(15 + Math.random() * 10)]),
        },
      ]);
    }
    return makeMatrixResponse([]);
  },

  async queryInstant(query) {
    // Cache read tokens
    if (query.includes('cache_read') && !query.includes('cache_write') && !query.includes('input')) {
      return makeVectorResponse([{ labels: {}, value: '67400' }]);
    }
    // Cache write tokens
    if (query.includes('cache_write') && !query.includes('cache_read')) {
      return makeVectorResponse([{ labels: {}, value: '12600' }]);
    }
    // Input tokens
    if (query.includes('gen_ai_token_type=~"input"') && !query.includes('cache')) {
      return makeVectorResponse([{ labels: {}, value: '482300' }]);
    }
    // Cache by model (for savings)
    if (
      query.includes('gen_ai_provider_name') &&
      query.includes('gen_ai_request_model') &&
      query.includes('cache_read|input')
    ) {
      return makeVectorResponse([
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'cache_read' },
          value: '40000',
        },
        {
          labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
          value: '300000',
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'cache_read',
          },
          value: '27400',
        },
        {
          labels: {
            gen_ai_provider_name: 'anthropic',
            gen_ai_request_model: 'claude-sonnet-4-20250514',
            gen_ai_token_type: 'input',
          },
          value: '182300',
        },
      ]);
    }
    // Cache read by breakdown
    if (query.includes('cache_read') && query.includes('gen_ai_provider_name')) {
      return makeVectorResponse([
        { labels: { gen_ai_provider_name: 'openai' }, value: '40000' },
        { labels: { gen_ai_provider_name: 'anthropic' }, value: '27400' },
      ]);
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
  async searchConversations() {
    return {
      conversations: [
        {
          conversation_id: 'conv-cache-001',
          generation_count: 8,
          first_generation_at: '2026-03-03T08:00:00Z',
          last_generation_at: '2026-03-03T09:30:00Z',
          models: ['gpt-4o'],
          agents: ['assistant'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-1'],
          annotation_count: 0,
          selected: {
            'span.gen_ai.usage.input_tokens': 48200,
            'span.gen_ai.usage.cache_read_input_tokens': 0,
          },
        },
        {
          conversation_id: 'conv-cache-002',
          generation_count: 15,
          first_generation_at: '2026-03-03T07:00:00Z',
          last_generation_at: '2026-03-03T09:15:00Z',
          models: ['gpt-4o', 'claude-sonnet-4-20250514'],
          agents: ['code-assistant'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-2'],
          annotation_count: 0,
          selected: {
            'span.gen_ai.usage.input_tokens': 125000,
            'span.gen_ai.usage.cache_read_input_tokens': 82000,
          },
        },
        {
          conversation_id: 'conv-cache-003',
          generation_count: 3,
          first_generation_at: '2026-03-03T09:00:00Z',
          last_generation_at: '2026-03-03T09:05:00Z',
          models: ['claude-sonnet-4-20250514'],
          agents: [],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-3'],
          annotation_count: 0,
          selected: {
            'span.gen_ai.usage.input_tokens': 9500,
            'span.gen_ai.usage.cache_read_input_tokens': 1200,
          },
        },
        {
          conversation_id: 'conv-cache-004',
          generation_count: 22,
          first_generation_at: '2026-03-03T06:00:00Z',
          last_generation_at: '2026-03-03T08:45:00Z',
          models: ['gpt-4o'],
          agents: ['data-analyst'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-4'],
          annotation_count: 0,
          selected: {
            'span.gen_ai.usage.input_tokens': 310000,
            'span.gen_ai.usage.cache_read_input_tokens': 0,
          },
        },
      ],
      has_more: false,
    };
  },
  async getConversationDetail() {
    return {
      conversation_id: '',
      generation_count: 0,
      first_generation_at: '',
      last_generation_at: '',
      generations: [],
      annotations: [],
    };
  },
  async getGeneration() {
    return { generation_id: '', conversation_id: '' };
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
};

const meta = {
  title: 'Dashboard/DashboardCacheGrid',
  component: DashboardCacheGrid,
};

export default meta;

export const Default = {
  render: () => (
    <DashboardCacheGrid
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
    <DashboardCacheGrid
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
