import React from 'react';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { DashboardErrorsGrid } from '../components/dashboard/DashboardErrorsGrid';
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

const mockDataSource: DashboardDataSource = {
  async queryRange(query) {
    if (query.includes('* 100')) {
      return makeMatrixResponse([{ labels: {}, values: timePoints.map((t) => [t, String(2 + Math.random() * 1.5)]) }]);
    }
    if (query.includes('error_type!=""') && query.includes('by')) {
      return makeMatrixResponse([
        {
          labels: { error_type: '429' },
          values: timePoints.map((t) => [t, String(0.02 + Math.random() * 0.01)]),
        },
        {
          labels: { error_type: '500' },
          values: timePoints.map((t) => [t, String(0.005 + Math.random() * 0.005)]),
        },
        {
          labels: { error_type: '503' },
          values: timePoints.map((t) => [t, String(0.001 + Math.random() * 0.002)]),
        },
      ]);
    }
    return makeMatrixResponse([]);
  },

  async queryInstant(query) {
    if (query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '2.3' }]);
    }
    if (query.includes('by (error_type)')) {
      return makeVectorResponse([
        { labels: { error_type: '429' }, value: '42' },
        { labels: { error_type: '500' }, value: '18' },
        { labels: { error_type: '503' }, value: '5' },
      ]);
    }
    if (query.includes('error_type!=""')) {
      return makeVectorResponse([{ labels: {}, value: '65' }]);
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
      resolved: pairs.map(({ provider, model }) => ({
        provider,
        model,
        status: 'unresolved' as const,
        reason: 'not_found' as const,
      })),
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
          conversation_id: 'conv-err-001',
          generation_count: 5,
          first_generation_at: '2026-03-03T08:00:00Z',
          last_generation_at: '2026-03-03T09:30:00Z',
          models: ['gpt-4o'],
          agents: ['assistant'],
          error_count: 3,
          has_errors: true,
          trace_ids: ['trace-1'],
          annotation_count: 0,
        },
        {
          conversation_id: 'conv-err-002',
          generation_count: 12,
          first_generation_at: '2026-03-03T07:00:00Z',
          last_generation_at: '2026-03-03T09:15:00Z',
          models: ['gpt-4o', 'claude-sonnet-4-20250514'],
          agents: ['code-assistant'],
          error_count: 1,
          has_errors: true,
          trace_ids: ['trace-2'],
          annotation_count: 1,
        },
        {
          conversation_id: 'conv-err-003',
          generation_count: 2,
          first_generation_at: '2026-03-03T09:00:00Z',
          last_generation_at: '2026-03-03T09:05:00Z',
          models: ['claude-sonnet-4-20250514'],
          agents: [],
          error_count: 2,
          has_errors: true,
          trace_ids: ['trace-3'],
          annotation_count: 0,
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
  title: 'Dashboard/DashboardErrorsGrid',
  component: DashboardErrorsGrid,
};

export default meta;

export const Default = {
  render: () => (
    <DashboardErrorsGrid
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

export const WithBreakdown = {
  render: () => (
    <DashboardErrorsGrid
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
