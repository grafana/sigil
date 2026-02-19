import type { DashboardFilters } from './types';

// OTel metric names converted to Prometheus format (dots → underscores).
const TOKEN_USAGE = 'gen_ai_client_token_usage';
const OPERATION_DURATION = 'gen_ai_client_operation_duration_seconds';
const TIME_TO_FIRST_TOKEN = 'gen_ai_client_time_to_first_token_seconds';
const PROMETHEUS_LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function escapePrometheusRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function fuzzyMatcher(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !PROMETHEUS_LABEL_NAME.test(label)) {
    return '';
  }
  return `${label}=~"(?i).*${escapePrometheusRegex(trimmed)}.*"`;
}

function normalizeExtraMatchers(matchers: string): string[] {
  const trimmed = matchers.trim();
  if (!trimmed) {
    return [];
  }

  const braceWrapped = trimmed.match(/^\{([\s\S]*)\}$/);
  const body = braceWrapped ? braceWrapped[1] : trimmed;
  return body
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildLabelSelector(filters: DashboardFilters): string {
  const parts: string[] = [];
  if (filters.provider) {
    parts.push(fuzzyMatcher('gen_ai_provider_name', filters.provider));
  }
  if (filters.model) {
    parts.push(fuzzyMatcher('gen_ai_request_model', filters.model));
  }
  if (filters.agentName) {
    parts.push(fuzzyMatcher('gen_ai_agent_name', filters.agentName));
  }
  if (filters.labelKey && filters.labelValue) {
    parts.push(fuzzyMatcher(filters.labelKey.trim(), filters.labelValue));
  }
  parts.push(...normalizeExtraMatchers(filters.extraMatchers));
  return parts.filter(Boolean).join(',');
}

function sel(filters: DashboardFilters, extra?: string): string {
  const parts = [buildLabelSelector(filters), extra].filter(Boolean).join(',');
  return parts ? `{${parts}}` : '';
}

/** Compute step for query_range: target ~250 data points, min 15s. */
export function computeStep(from: number, to: number): number {
  return Math.max(Math.floor((to - from) / 250), 15);
}

/** Compute rate interval: at least 4× step or 60s. */
export function computeRateInterval(step: number): string {
  return `${Math.max(step * 4, 60)}s`;
}

/** Full time range as a Prometheus duration string for instant queries. */
export function computeRangeDuration(from: number, to: number): string {
  return `${to - from}s`;
}

// --- Stat panel queries (instant) ---

export function totalOpsQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum(increase(${OPERATION_DURATION}_count${sel(filters)}[${rangeDuration}]))`;
}

export function totalTokensQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum(increase(${TOKEN_USAGE}_sum${sel(filters)}[${rangeDuration}]))`;
}

export function totalErrorsQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum(increase(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${rangeDuration}]))`;
}

export function errorRateQuery(filters: DashboardFilters, rangeDuration: string): string {
  const errors = `sum(increase(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${rangeDuration}]))`;
  const total = `sum(increase(${OPERATION_DURATION}_count${sel(filters)}[${rangeDuration}]))`;
  return `(${errors} / ${total}) * 100`;
}

// --- Timeseries panel queries (range) ---

export function tokenUsageOverTimeQuery(filters: DashboardFilters, interval: string): string {
  return `sum by (gen_ai_token_type) (rate(${TOKEN_USAGE}_sum${sel(filters)}[${interval}]))`;
}

export function tokenUsageByModelQuery(filters: DashboardFilters, interval: string): string {
  return `sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type) (rate(${TOKEN_USAGE}_sum${sel(filters)}[${interval}]))`;
}

export function rpsByModelOverTimeQuery(filters: DashboardFilters, interval: string): string {
  return `sum by (gen_ai_provider_name, gen_ai_request_model) (rate(${OPERATION_DURATION}_count${sel(filters)}[${interval}]))`;
}

export function latencyP95Query(filters: DashboardFilters, interval: string): string {
  return `histogram_quantile(0.95, sum by (le) (rate(${OPERATION_DURATION}_bucket${sel(filters)}[${interval}])))`;
}

export function ttftP95Query(filters: DashboardFilters, interval: string): string {
  return `histogram_quantile(0.95, sum by (le) (rate(${TIME_TO_FIRST_TOKEN}_bucket${sel(filters)}[${interval}])))`;
}

// --- Piechart panel queries (instant) ---

export function callsByProviderQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum by (gen_ai_provider_name) (increase(${OPERATION_DURATION}_count${sel(filters)}[${rangeDuration}]))`;
}

export function topModelsQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `topk(10, sum by (gen_ai_provider_name, gen_ai_request_model) (increase(${OPERATION_DURATION}_count${sel(filters)}[${rangeDuration}])))`;
}

// --- Cost queries (token totals by model + type, for client-side pricing) ---

export function tokensByModelAndTypeQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type) (increase(${TOKEN_USAGE}_sum${sel(filters)}[${rangeDuration}]))`;
}
