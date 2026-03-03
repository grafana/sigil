import { breakdownToPromLabel, type BreakdownDimension, type DashboardFilters } from './types';

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
  for (const lf of filters.labelFilters) {
    if (lf.key && lf.value) {
      parts.push(fuzzyMatcher(lf.key.trim(), lf.value));
    }
  }
  return parts.filter(Boolean).join(',');
}

function sel(filters: DashboardFilters, extra?: string): string {
  const parts = [buildLabelSelector(filters), extra].filter(Boolean).join(',');
  return parts ? `{${parts}}` : '';
}

/** Build a PromQL `by (...)` clause from breakdown dimension + extra required labels. */
function byClause(breakdown: BreakdownDimension, extraLabels?: string[]): string {
  const labels = [...(extraLabels ?? [])];
  const bl = breakdownToPromLabel[breakdown];
  if (bl) {
    labels.push(bl);
  }
  return labels.length > 0 ? ` by (${labels.join(', ')})` : '';
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

// ---------------------------------------------------------------------------
// Stat panel queries (instant) — with optional breakdown
// ---------------------------------------------------------------------------

export function totalOpsQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(increase(${OPERATION_DURATION}_count${sel(filters)}[${rangeDuration}]))`;
}

export function totalErrorsQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum(increase(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${rangeDuration}]))`;
}

export function errorRateQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none'
): string {
  const errors = `sum${byClause(breakdown)}(increase(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${rangeDuration}]))`;
  const total = `sum${byClause(breakdown)}(increase(${OPERATION_DURATION}_count${sel(filters)}[${rangeDuration}]))`;
  return `(${errors} / ${total}) * 100`;
}

export function latencyStatQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none',
  quantile = 0.95
): string {
  return `histogram_quantile(${quantile}, sum${byClause(breakdown, ['le'])}(increase(${OPERATION_DURATION}_bucket${sel(filters)}[${rangeDuration}])))`;
}

/** Token totals by model+type for client-side cost calculation. Optionally includes breakdown label. */
export function tokensByModelAndTypeQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none'
): string {
  const baseLabels = ['gen_ai_provider_name', 'gen_ai_request_model', 'gen_ai_token_type'];
  const bl = breakdownToPromLabel[breakdown];
  if (bl && !baseLabels.includes(bl)) {
    baseLabels.push(bl);
  }
  return `sum by (${baseLabels.join(', ')}) (increase(${TOKEN_USAGE}_sum${sel(filters)}[${rangeDuration}]))`;
}

// ---------------------------------------------------------------------------
// Timeseries queries (range) — with breakdown support
// ---------------------------------------------------------------------------

/** Successful requests rate (error_type=""). Used when breakdown=none for the success/error split. */
export function requestsSuccessOverTimeQuery(filters: DashboardFilters, interval: string): string {
  return `sum(rate(${OPERATION_DURATION}_count${sel(filters, 'error_type=""')}[${interval}]))`;
}

/** Failed requests rate (error_type!=""). Used when breakdown=none for the success/error split. */
export function requestsErrorOverTimeQuery(filters: DashboardFilters, interval: string): string {
  return `sum(rate(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${interval}]))`;
}

/** Total requests rate, optionally grouped by breakdown dimension. */
export function requestsOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension
): string {
  return `sum${byClause(breakdown)}(rate(${OPERATION_DURATION}_count${sel(filters)}[${interval}]))`;
}

/** Error rate as percentage over time, optionally grouped by breakdown dimension. */
export function errorRateOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension
): string {
  const errors = `sum${byClause(breakdown)}(rate(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${interval}]))`;
  const total = `sum${byClause(breakdown)}(rate(${OPERATION_DURATION}_count${sel(filters)}[${interval}]))`;
  return `(${errors} / ${total}) * 100`;
}

/** Error rate as percentage over time, broken down by error_type (and optionally by breakdown dimension). */
export function errorsByCodeOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension
): string {
  const errorsByType = `sum${byClause(breakdown, ['error_type'])}(rate(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${interval}]))`;
  const total = `sum${byClause(breakdown)}(rate(${OPERATION_DURATION}_count${sel(filters)}[${interval}]))`;
  const bl = breakdownToPromLabel[breakdown];
  const div = bl ? `${errorsByType} / on(${bl}) group_left() ${total}` : `${errorsByType} / scalar(${total})`;
  return `(${div}) * 100`;
}

/** Error count broken down by error_type (instant stat for pie/bar). */
export function errorsByCodeStatQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum by (error_type)(increase(${OPERATION_DURATION}_count${sel(filters, 'error_type!=""')}[${rangeDuration}]))`;
}

/** Errors filtered to a specific error_type, optionally grouped by breakdown dimension. */
export function errorsBySpecificCodeOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension,
  errorCode: string
): string {
  return `sum${byClause(breakdown)}(rate(${OPERATION_DURATION}_count${sel(filters, `error_type="${errorCode}"`)}[${interval}]))`;
}

/** Latency at a given quantile, optionally grouped by breakdown dimension. */
export function latencyOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension,
  quantile: number
): string {
  return `histogram_quantile(${quantile}, sum${byClause(breakdown, ['le'])}(rate(${OPERATION_DURATION}_bucket${sel(filters)}[${interval}])))`;
}

/** P95 latency, optionally grouped by breakdown dimension. */
export function latencyP95OverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension
): string {
  return latencyOverTimeQuery(filters, interval, breakdown, 0.95);
}

/** P99 latency, optionally grouped by breakdown dimension. */
export function latencyP99OverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension
): string {
  return latencyOverTimeQuery(filters, interval, breakdown, 0.99);
}

/** P50 latency, optionally grouped by breakdown dimension. */
export function latencyP50OverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension
): string {
  return latencyOverTimeQuery(filters, interval, breakdown, 0.5);
}

/** TTFT over time, as a histogram quantile with optional breakdown. */
export function ttftOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension,
  quantile: number
): string {
  return `histogram_quantile(${quantile}, sum${byClause(breakdown, ['le'])}(rate(${TIME_TO_FIRST_TOKEN}_bucket${sel(filters)}[${interval}])))`;
}

/** Total token count (instant), optionally grouped by breakdown dimension and filtered by token types. */
export function totalTokensQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none',
  tokenTypes?: string[]
): string {
  const typeFilter = tokenTypes ? `gen_ai_token_type=~"${tokenTypes.join('|')}"` : undefined;
  return `sum${byClause(breakdown)}(increase(${TOKEN_USAGE}_sum${sel(filters, typeFilter)}[${rangeDuration}]))`;
}

/** Token usage rate over time, optionally grouped by breakdown dimension and filtered by token types. */
export function totalTokensOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension = 'none',
  tokenTypes?: string[]
): string {
  const typeFilter = tokenTypes ? `gen_ai_token_type=~"${tokenTypes.join('|')}"` : undefined;
  return `sum${byClause(breakdown)}(rate(${TOKEN_USAGE}_sum${sel(filters, typeFilter)}[${interval}]))`;
}

/** Token count broken down by both a breakdown dimension and token type. */
export function tokensByBreakdownAndTypeQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none',
  tokenTypes?: string[]
): string {
  const typeFilter = tokenTypes ? `gen_ai_token_type=~"${tokenTypes.join('|')}"` : undefined;
  return `sum${byClause(breakdown, ['gen_ai_token_type'])}(increase(${TOKEN_USAGE}_sum${sel(filters, typeFilter)}[${rangeDuration}]))`;
}

/** Token count broken down by type, optionally filtered to specific types. */
export function tokensByTypeQuery(filters: DashboardFilters, rangeDuration: string, tokenTypes?: string[]): string {
  const typeFilter = tokenTypes ? `gen_ai_token_type=~"${tokenTypes.join('|')}"` : undefined;
  return `sum by (gen_ai_token_type) (increase(${TOKEN_USAGE}_sum${sel(filters, typeFilter)}[${rangeDuration}]))`;
}

/** Token usage rate over time, broken down by type, optionally filtered to specific types and grouped by breakdown. */
export function tokensByTypeOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  tokenTypes?: string[],
  breakdown: BreakdownDimension = 'none'
): string {
  const typeFilter = tokenTypes ? `gen_ai_token_type=~"${tokenTypes.join('|')}"` : undefined;
  return `sum${byClause(breakdown, ['gen_ai_token_type'])}(rate(${TOKEN_USAGE}_sum${sel(filters, typeFilter)}[${interval}]))`;
}

/**
 * Token rates by model+type for client-side cost timeseries.
 * Always includes provider/model/token_type for pricing. Optionally adds the
 * breakdown label so cost can be grouped by dimension client-side.
 */
export function tokensByModelAndTypeOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension = 'none'
): string {
  const baseLabels = ['gen_ai_provider_name', 'gen_ai_request_model', 'gen_ai_token_type'];
  const bl = breakdownToPromLabel[breakdown];
  if (bl && !baseLabels.includes(bl)) {
    baseLabels.push(bl);
  }
  return `sum by (${baseLabels.join(', ')}) (rate(${TOKEN_USAGE}_sum${sel(filters)}[${interval}]))`;
}

// ---------------------------------------------------------------------------
// Cache-specific queries
// ---------------------------------------------------------------------------

/** Cache hit rate over time as a percentage, optionally grouped by breakdown dimension. */
export function cacheHitRateOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension = 'none'
): string {
  const cacheRead = `sum${byClause(breakdown)}(rate(${TOKEN_USAGE}_sum${sel(filters, 'gen_ai_token_type="cache_read"')}[${interval}]))`;
  const input = `sum${byClause(breakdown)}(rate(${TOKEN_USAGE}_sum${sel(filters, 'gen_ai_token_type="input"')}[${interval}]))`;
  return `(${cacheRead} / (${cacheRead} + ${input})) * 100`;
}

/** Cache read tokens over time, optionally grouped by breakdown dimension. */
export function cacheReadOverTimeQuery(
  filters: DashboardFilters,
  interval: string,
  breakdown: BreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(rate(${TOKEN_USAGE}_sum${sel(filters, 'gen_ai_token_type="cache_read"')}[${interval}]))`;
}

/** Cache read vs write tokens over time (broken down by token type). */
export function cacheTokensByTypeOverTimeQuery(filters: DashboardFilters, interval: string): string {
  return `sum by (gen_ai_token_type)(rate(${TOKEN_USAGE}_sum${sel(filters, 'gen_ai_token_type=~"cache_read|cache_write"')}[${interval}]))`;
}

/** Cache read tokens by breakdown dimension (instant). */
export function cacheReadByBreakdownQuery(
  filters: DashboardFilters,
  rangeDuration: string,
  breakdown: BreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(increase(${TOKEN_USAGE}_sum${sel(filters, 'gen_ai_token_type="cache_read"')}[${rangeDuration}]))`;
}

/** Cache tokens by model (for computing savings client-side). */
export function cacheTokensByModelQuery(filters: DashboardFilters, rangeDuration: string): string {
  return `sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type) (increase(${TOKEN_USAGE}_sum${sel(filters, 'gen_ai_token_type=~"cache_read|input"')}[${rangeDuration}]))`;
}
