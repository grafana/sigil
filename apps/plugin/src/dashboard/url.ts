import type { TimeRange } from '@grafana/data';
import { PLUGIN_BASE, ROUTES, buildToolAnalyticsRoute } from '../constants';
import type { ConversationOrderBy, DashboardFilters, LabelFilter } from './types';

export function serializeRawTime(raw: string | { toISOString(): string }): string {
  if (typeof raw === 'string') {
    return raw;
  }
  return raw.toISOString();
}

function appendMulti(params: URLSearchParams, key: string, values: string[]): void {
  for (const value of values) {
    if (value) {
      params.append(key, value);
    }
  }
}

export function appendLabelFilters(params: URLSearchParams, filters: LabelFilter[]): void {
  for (const filter of filters) {
    if (filter.key && filter.value) {
      params.append('label', `${filter.key}|${filter.operator}|${filter.value}`);
    }
  }
}

export function buildDashboardSearchParams(timeRange: TimeRange, filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('from', serializeRawTime(timeRange.raw.from));
  params.set('to', serializeRawTime(timeRange.raw.to));
  appendMulti(params, 'provider', filters.providers);
  appendMulti(params, 'model', filters.models);
  appendMulti(params, 'agent', filters.agentNames);
  appendLabelFilters(params, filters.labelFilters);
  return params;
}

export function buildAnalyticsUrl(timeRange: TimeRange, filters: DashboardFilters): string {
  const params = buildDashboardSearchParams(timeRange, filters);
  return `${PLUGIN_BASE}/${ROUTES.Analytics}?${params.toString()}`;
}

export function buildConversationsUrl(
  timeRange: TimeRange,
  filters: DashboardFilters,
  orderBy: ConversationOrderBy
): string {
  const params = buildDashboardSearchParams(timeRange, filters);
  if (orderBy !== 'time') {
    params.set('orderBy', orderBy);
  }
  return `${PLUGIN_BASE}/${ROUTES.Conversations}?${params.toString()}`;
}

export function buildToolAnalyticsUrl(timeRange: TimeRange, filters: DashboardFilters, toolName: string): string {
  const params = buildDashboardSearchParams(timeRange, filters);
  return `${PLUGIN_BASE}/${buildToolAnalyticsRoute(toolName)}?${params.toString()}`;
}
