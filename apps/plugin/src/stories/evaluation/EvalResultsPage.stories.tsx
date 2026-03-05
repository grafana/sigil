import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import EvalResultsPage from '../../pages/EvalResultsPage';
import type { DashboardDataSource } from '../../dashboard/api';
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
  render: () => <EvalResultsPage dataSource={mockDataSource} />,
};
