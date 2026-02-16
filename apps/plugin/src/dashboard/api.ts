import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  ModelCard,
  ModelCardListResponse,
  PrometheusLabelsResponse,
  PrometheusLabelValuesResponse,
  PrometheusQueryResponse,
} from './types';

const queryBasePath = '/api/plugins/grafana-sigil-app/resources/query';
const genAIMetricsMatcher = '{__name__=~"gen_ai_client_.*"}';

export type DashboardDataSource = {
  queryRange: (query: string, start: number, end: number, step: number) => Promise<PrometheusQueryResponse>;
  queryInstant: (query: string, time: number) => Promise<PrometheusQueryResponse>;
  labels: (start: number, end: number) => Promise<string[]>;
  labelValues: (label: string, start: number, end: number) => Promise<string[]>;
  listModelCards: () => Promise<ModelCard[]>;
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

  async labels(start, end) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PrometheusLabelsResponse>({
        method: 'GET',
        url: `${queryBasePath}/proxy/prometheus/api/v1/labels`,
        params: { start, end, 'match[]': genAIMetricsMatcher },
      })
    );
    return response.data.data ?? [];
  },

  async labelValues(label, start, end) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PrometheusLabelValuesResponse>({
        method: 'GET',
        url: `${queryBasePath}/proxy/prometheus/api/v1/label/${encodeURIComponent(label)}/values`,
        params: { start, end, 'match[]': genAIMetricsMatcher },
      })
    );
    return response.data.data ?? [];
  },

  async listModelCards() {
    const allCards: ModelCard[] = [];
    let cursor = '';
    do {
      const params: Record<string, string | number> = { limit: 200 };
      if (cursor) {
        params.cursor = cursor;
      }
      const response = await lastValueFrom(
        getBackendSrv().fetch<ModelCardListResponse>({
          method: 'GET',
          url: `${queryBasePath}/model-cards`,
          params,
        })
      );
      allCards.push(...(response.data.data ?? []));
      cursor = response.data.next_cursor ?? '';
    } while (cursor);
    return allCards;
  },
};
