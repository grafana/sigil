import React from 'react';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { DashboardEvalGrid } from '../components/dashboard/DashboardEvalGrid';
import type { DashboardDataSource } from '../dashboard/api';
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
    if (query.includes('passed="true"') && !query.includes('* 100')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.8 + Math.random() * 0.2)] as [number, string]) },
      ]);
    }
    if (query.includes('passed="false"')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.05 + Math.random() * 0.1)] as [number, string]) },
      ]);
    }
    if (query.includes('* 100')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(88 + Math.random() * 8)] as [number, string]) },
      ]);
    }
    if (query.includes('duration_seconds_bucket')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.2 + Math.random() * 0.15)] as [number, string]) },
      ]);
    }
    if (query.includes('status="failed"')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(Math.random() * 0.02)] as [number, string]) },
      ]);
    }
    if (query.includes('executions_total')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.3 + Math.random() * 0.2)] as [number, string]) },
      ]);
    }
    return makeMatrixResponse([
      { labels: {}, values: timePoints.map((t) => [t, String(1 + Math.random())] as [number, string]) },
    ]);
  },

  async queryInstant(query) {
    if (query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '92.4' }]);
    }
    if (query.includes('duration_seconds_bucket')) {
      return makeVectorResponse([{ labels: {}, value: '0.31' }]);
    }
    if (query.includes('executions_total')) {
      return makeVectorResponse([{ labels: {}, value: '412' }]);
    }
    if (query.includes('by (evaluator)')) {
      return makeVectorResponse([
        { labels: { evaluator: 'helpfulness' }, value: '320' },
        { labels: { evaluator: 'safety' }, value: '280' },
        { labels: { evaluator: 'relevance' }, value: '195' },
      ]);
    }
    return makeVectorResponse([{ labels: {}, value: '795' }]);
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
  title: 'Dashboard/DashboardEvalGrid',
  component: DashboardEvalGrid,
};

export default meta;

export const Default = {
  render: () => (
    <DashboardEvalGrid
      dataSource={mockDataSource}
      filters={emptyFilters}
      breakdownBy="none"
      from={from}
      to={to}
      timeRange={timeRange}
      onTimeRangeChange={() => {}}
    />
  ),
};

export const BreakdownByModel = {
  render: () => (
    <DashboardEvalGrid
      dataSource={mockDataSource}
      filters={emptyFilters}
      breakdownBy="model"
      from={from}
      to={to}
      timeRange={timeRange}
      onTimeRangeChange={() => {}}
    />
  ),
};
