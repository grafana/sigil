import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import EvalResultsPage from '../../pages/EvalResultsPage';
import type { DashboardDataSource } from '../../dashboard/api';
import type { ConversationsDataSource } from '../../conversation/api';
import type { PrometheusQueryResponse } from '../../dashboard/types';

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
    if (query.includes('passed="true"') && !query.includes('* 100')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.9 + Math.random() * 0.3)] as [number, string]) },
      ]);
    }
    if (query.includes('passed="false"')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.04 + Math.random() * 0.08)] as [number, string]) },
      ]);
    }
    if (query.includes('* 100')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(89 + Math.random() * 7)] as [number, string]) },
      ]);
    }
    if (query.includes('duration_seconds_bucket')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.25 + Math.random() * 0.15)] as [number, string]) },
      ]);
    }
    return makeMatrixResponse([
      { labels: {}, values: timePoints.map((t) => [t, String(1 + Math.random())] as [number, string]) },
    ]);
  },

  async queryInstant(query) {
    if (query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '91.7' }]);
    }
    if (query.includes('duration_seconds_bucket')) {
      return makeVectorResponse([{ labels: {}, value: '0.34' }]);
    }
    if (query.includes('by (evaluator)')) {
      return makeVectorResponse([
        { labels: { evaluator: 'helpfulness' }, value: '420' },
        { labels: { evaluator: 'safety' }, value: '380' },
        { labels: { evaluator: 'relevance' }, value: '310' },
        { labels: { evaluator: 'coherence' }, value: '210' },
      ]);
    }
    return makeVectorResponse([{ labels: {}, value: '1320' }]);
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
          conversation_id: 'conv-eval-001',
          conversation_title: 'Debug failing CI pipeline',
          generation_count: 12,
          first_generation_at: '2026-03-05T08:00:00Z',
          last_generation_at: '2026-03-05T09:30:00Z',
          models: ['gpt-4o'],
          agents: ['code-assistant'],
          error_count: 2,
          has_errors: true,
          trace_ids: ['trace-1'],
          annotation_count: 0,
          eval_summary: { total_scores: 12, pass_count: 3, fail_count: 9 },
        },
        {
          conversation_id: 'conv-eval-002',
          conversation_title: 'Summarize quarterly report',
          generation_count: 5,
          first_generation_at: '2026-03-05T10:00:00Z',
          last_generation_at: '2026-03-05T10:15:00Z',
          models: ['claude-sonnet-4-20250514'],
          agents: ['research-agent'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-2'],
          annotation_count: 1,
          eval_summary: { total_scores: 5, pass_count: 2, fail_count: 3 },
        },
        {
          conversation_id: 'conv-eval-003',
          conversation_title: 'Generate SQL migration',
          generation_count: 8,
          first_generation_at: '2026-03-04T14:00:00Z',
          last_generation_at: '2026-03-04T14:45:00Z',
          models: ['gpt-4o', 'o3-mini'],
          agents: ['db-assistant'],
          error_count: 1,
          has_errors: true,
          trace_ids: ['trace-3'],
          annotation_count: 0,
          eval_summary: { total_scores: 8, pass_count: 4, fail_count: 4 },
        },
        {
          conversation_id: 'conv-eval-004',
          conversation_title: 'Translate marketing copy to Spanish',
          generation_count: 3,
          first_generation_at: '2026-03-05T11:00:00Z',
          last_generation_at: '2026-03-05T11:05:00Z',
          models: ['gpt-4o-mini'],
          agents: ['translation'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-4'],
          annotation_count: 0,
          eval_summary: { total_scores: 6, pass_count: 4, fail_count: 2 },
        },
        {
          conversation_id: 'conv-eval-005',
          conversation_title: 'Code review PR #482',
          generation_count: 20,
          first_generation_at: '2026-03-04T09:00:00Z',
          last_generation_at: '2026-03-04T10:30:00Z',
          models: ['claude-sonnet-4-20250514', 'gpt-4o'],
          agents: ['code-assistant'],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-5'],
          annotation_count: 2,
          eval_summary: { total_scores: 20, pass_count: 15, fail_count: 5 },
        },
        {
          conversation_id: 'conv-eval-006',
          generation_count: 2,
          first_generation_at: '2026-03-05T15:00:00Z',
          last_generation_at: '2026-03-05T15:02:00Z',
          models: ['gpt-4o-mini'],
          agents: [],
          error_count: 0,
          has_errors: false,
          trace_ids: ['trace-6'],
          annotation_count: 0,
          eval_summary: { total_scores: 2, pass_count: 0, fail_count: 2 },
        },
      ],
      has_more: false,
    };
  },
  async getConversationDetail() {
    throw new Error('not implemented in story');
  },
  async getGeneration() {
    throw new Error('not implemented in story');
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
};

const meta = {
  title: 'Sigil/Evaluation/EvalResultsPage',
  component: EvalResultsPage,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter initialEntries={['/a/grafana-sigil-app/evaluation/results']}>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export default meta;

export const Default = {
  render: () => <EvalResultsPage dataSource={mockDataSource} conversationsDataSource={mockConversationsDataSource} />,
};
