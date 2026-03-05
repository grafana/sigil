import React from 'react';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { DashboardGrid } from '../components/dashboard/DashboardGrid';
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
    if (
      query.includes('token_usage') &&
      query.includes('gen_ai_token_type') &&
      query.includes('gen_ai_provider_name') &&
      !query.includes('gen_ai_request_model')
    ) {
      const providers = ['openai', 'anthropic'];
      const allTypes = [
        { type: 'input', base: 60 },
        { type: 'output', base: 25 },
        { type: 'cache_read', base: 10 },
        { type: 'cache_write', base: 3 },
      ];
      const filtered = allTypes.filter((t) => {
        if (query.includes('gen_ai_token_type=~')) {
          return query.includes(t.type);
        }
        return true;
      });
      const series = providers.flatMap((p) =>
        filtered.map((t) => ({
          labels: { gen_ai_provider_name: p, gen_ai_token_type: t.type },
          values: timePoints.map((ts) => [ts, String(t.base + Math.random() * t.base * 0.5)] as [number, string]),
        }))
      );
      return makeMatrixResponse(series);
    }
    if (
      query.includes('token_usage') &&
      query.includes('gen_ai_token_type') &&
      !query.includes('gen_ai_request_model')
    ) {
      const allTypes = [
        {
          labels: { gen_ai_token_type: 'input' },
          values: timePoints.map((t) => [t, String(100 + Math.random() * 50)] as [number, string]),
        },
        {
          labels: { gen_ai_token_type: 'output' },
          values: timePoints.map((t) => [t, String(40 + Math.random() * 20)] as [number, string]),
        },
        {
          labels: { gen_ai_token_type: 'cache_read' },
          values: timePoints.map((t) => [t, String(15 + Math.random() * 10)] as [number, string]),
        },
        {
          labels: { gen_ai_token_type: 'cache_write' },
          values: timePoints.map((t) => [t, String(5 + Math.random() * 5)] as [number, string]),
        },
      ];
      const filtered = allTypes.filter((s) => {
        if (query.includes('gen_ai_token_type=~')) {
          return query.includes(s.labels.gen_ai_token_type);
        }
        return true;
      });
      return makeMatrixResponse(filtered);
    }
    if (
      query.includes('token_usage') &&
      !query.includes('gen_ai_request_model') &&
      !query.includes('gen_ai_token_type')
    ) {
      if (query.includes('gen_ai_provider_name')) {
        return makeMatrixResponse([
          {
            labels: { gen_ai_provider_name: 'openai' },
            values: timePoints.map((t) => [t, String(200 + Math.random() * 80)] as [number, string]),
          },
          {
            labels: { gen_ai_provider_name: 'anthropic' },
            values: timePoints.map((t) => [t, String(120 + Math.random() * 40)] as [number, string]),
          },
        ]);
      }
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(300 + Math.random() * 100)] as [number, string]) },
      ]);
    }
    if (query.includes('token_usage')) {
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
      ]);
    }
    if (query.includes('operation_duration_seconds_bucket')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.3 + Math.random() * 0.2)]) },
      ]);
    }
    if (query.includes('error_type!=""') && query.includes('error_type')) {
      return makeMatrixResponse([
        {
          labels: { error_type: '429' },
          values: timePoints.map((t) => [t, String(0.02 + Math.random() * 0.01)]),
        },
        {
          labels: { error_type: '500' },
          values: timePoints.map((t) => [t, String(0.005 + Math.random() * 0.005)]),
        },
      ]);
    }
    if (query.includes('error_type=""')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(1.8 + Math.random() * 0.4)]) },
      ]);
    }
    if (query.includes('error_type!=""')) {
      return makeMatrixResponse([
        { labels: {}, values: timePoints.map((t) => [t, String(0.03 + Math.random() * 0.02)]) },
      ]);
    }
    return makeMatrixResponse([{ labels: {}, values: timePoints.map((t) => [t, String(1 + Math.random())]) }]);
  },

  async queryInstant(query) {
    if (query.includes('error_type') && query.includes('* 100')) {
      return makeVectorResponse([{ labels: {}, value: '2.3' }]);
    }
    if (query.includes('error_type')) {
      return makeVectorResponse([{ labels: {}, value: '15' }]);
    }
    if (query.includes('operation_duration_seconds_bucket')) {
      return makeVectorResponse([{ labels: {}, value: '0.42' }]);
    }
    if (query.includes('token_usage') && query.includes('by (gen_ai_token_type)')) {
      const allTypes = [
        { labels: { gen_ai_token_type: 'input' }, value: '482300' },
        { labels: { gen_ai_token_type: 'output' }, value: '195700' },
        { labels: { gen_ai_token_type: 'cache_read' }, value: '67400' },
        { labels: { gen_ai_token_type: 'cache_write' }, value: '12600' },
      ];
      const filtered = allTypes.filter((r) => {
        if (query.includes('gen_ai_token_type=~')) {
          return query.includes(r.labels.gen_ai_token_type);
        }
        return true;
      });
      return makeVectorResponse(filtered);
    }
    if (
      query.includes('token_usage') &&
      query.includes('gen_ai_token_type=~') &&
      query.includes('by (gen_ai_provider_name)')
    ) {
      return makeVectorResponse([
        { labels: { gen_ai_provider_name: 'openai' }, value: '420000' },
        { labels: { gen_ai_provider_name: 'anthropic' }, value: '111000' },
      ]);
    }
    if (
      query.includes('token_usage') &&
      !query.includes('gen_ai_request_model') &&
      !query.includes('gen_ai_token_type')
    ) {
      if (query.includes('gen_ai_provider_name')) {
        return makeVectorResponse([
          { labels: { gen_ai_provider_name: 'openai' }, value: '580000' },
          { labels: { gen_ai_provider_name: 'anthropic' }, value: '178000' },
        ]);
      }
      return makeVectorResponse([{ labels: {}, value: '758000' }]);
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
      ]);
    }
    return makeVectorResponse([{ labels: {}, value: '650' }]);
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
  title: 'Dashboard/DashboardGrid',
  component: DashboardGrid,
};

export default meta;

export const NoBreakdown = {
  render: () => (
    <DashboardGrid
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

export const BreakdownByProvider = {
  render: () => (
    <DashboardGrid
      dataSource={mockDataSource}
      filters={emptyFilters}
      breakdownBy="provider"
      from={from}
      to={to}
      timeRange={timeRange}
      onTimeRangeChange={() => {}}
    />
  ),
};

export const TokensMode = {
  render: () => (
    <DashboardGrid
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

export const TokensModeWithBreakdown = {
  render: () => (
    <DashboardGrid
      dataSource={mockDataSource}
      filters={emptyFilters}
      breakdownBy="provider"
      from={from}
      to={to}
      timeRange={timeRange}
      onTimeRangeChange={() => {}}
    />
  ),
};
