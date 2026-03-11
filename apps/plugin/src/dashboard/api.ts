import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  ModelCardResolveResponse,
  ModelResolvePair,
  PrometheusLabelsResponse,
  PrometheusLabelValuesResponse,
  PrometheusQueryResponse,
} from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';
const genAIMetricsMatcher = '{__name__=~"gen_ai_client_.*"}';

function mergeMetricsMatcher(matchers?: string): string {
  if (!matchers) {
    return genAIMetricsMatcher;
  }
  const base = genAIMetricsMatcher.slice(1, -1);
  const extra = matchers.startsWith('{') ? matchers.slice(1, -1) : matchers;
  return `{${base},${extra}}`;
}

export type DashboardDataSource = {
  queryRange: (query: string, start: number, end: number, step: number) => Promise<PrometheusQueryResponse>;
  queryInstant: (query: string, time: number) => Promise<PrometheusQueryResponse>;
  labels: (start: number, end: number, matchers?: string) => Promise<string[]>;
  labelValues: (label: string, start: number, end: number, matchers?: string) => Promise<string[]>;
  resolveModelCards: (pairs: ModelResolvePair[]) => Promise<ModelCardResolveResponse>;
};

export const defaultDashboardDataSource: DashboardDataSource = {
  async queryRange(query, start, end, step) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PrometheusQueryResponse>({
        method: 'GET',
        url: `${queryBasePath}/proxy/prometheus/api/v1/query_range`,
        params: { query, start, end, step },
      })
    );
    return response.data;
  },

  async queryInstant(query, time) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PrometheusQueryResponse>({
        method: 'GET',
        url: `${queryBasePath}/proxy/prometheus/api/v1/query`,
        params: { query, time },
      })
    );
    return response.data;
  },

  async labels(start, end, matchers) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PrometheusLabelsResponse>({
        method: 'GET',
        url: `${queryBasePath}/proxy/prometheus/api/v1/labels`,
        params: { start, end, 'match[]': mergeMetricsMatcher(matchers) },
      })
    );
    return response.data.data ?? [];
  },

  async labelValues(label, start, end, matchers?) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PrometheusLabelValuesResponse>({
        method: 'GET',
        url: `${queryBasePath}/proxy/prometheus/api/v1/label/${encodeURIComponent(label)}/values`,
        params: { start, end, 'match[]': mergeMetricsMatcher(matchers) },
      })
    );
    return response.data.data ?? [];
  },

  async resolveModelCards(pairs) {
    const query = new URLSearchParams();
    for (const pair of pairs) {
      query.append('resolve_pair', `${pair.provider}:${pair.model}`);
    }
    const response = await lastValueFrom(
      getBackendSrv().fetch<ModelCardResolveResponse>({
        method: 'GET',
        url: `${queryBasePath}/model-cards?${query.toString()}`,
      })
    );
    return response.data;
  },
};
