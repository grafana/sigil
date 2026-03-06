import { buildLabelSelector, escapePrometheusRegex } from '../dashboard/queries';
import type { DashboardFilters } from '../dashboard/types';

const SCORES_TOTAL = 'sigil_eval_scores_total';
const EXECUTIONS_TOTAL = 'sigil_eval_executions_total';
const DURATION_SECONDS = 'sigil_eval_duration_seconds';

export type EvalBreakdownDimension = 'none' | 'evaluator' | 'score_key' | 'evaluator_kind' | 'model' | 'agent';

export const evalBreakdownLabel: Record<EvalBreakdownDimension, string> = {
  none: 'None',
  evaluator: 'Evaluator',
  score_key: 'Score Key',
  evaluator_kind: 'Kind',
  model: 'Model',
  agent: 'Agent',
};

const evalBreakdownToPromLabel: Record<EvalBreakdownDimension, string> = {
  none: '',
  evaluator: 'evaluator',
  score_key: 'score_key',
  evaluator_kind: 'evaluator_kind',
  model: 'gen_ai_request_model',
  agent: 'gen_ai_agent_name',
};

export type EvalFilters = {
  evaluators: string[];
  scoreKeys: string[];
  evaluatorKinds: string[];
};

export const emptyEvalFilters: EvalFilters = {
  evaluators: [],
  scoreKeys: [],
  evaluatorKinds: [],
};

function multiMatcher(label: string, values: string[]): string {
  const trimmed = values.map((v) => v.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.length === 1) {
    return `${label}="${trimmed[0]}"`;
  }
  const pattern = trimmed.map(escapePrometheusRegex).join('|');
  return `${label}=~"${pattern}"`;
}

function evalLabelSelector(dashFilters: DashboardFilters, evalFilters: EvalFilters, extra?: string): string {
  const parts: string[] = [];

  const dashPart = buildLabelSelector(dashFilters);
  if (dashPart) {
    parts.push(dashPart);
  }

  if (evalFilters.evaluators.length > 0) {
    parts.push(multiMatcher('evaluator', evalFilters.evaluators));
  }
  if (evalFilters.scoreKeys.length > 0) {
    parts.push(multiMatcher('score_key', evalFilters.scoreKeys));
  }
  if (evalFilters.evaluatorKinds.length > 0) {
    parts.push(multiMatcher('evaluator_kind', evalFilters.evaluatorKinds));
  }

  if (extra) {
    parts.push(extra);
  }

  const joined = parts.filter(Boolean).join(',');
  return joined ? `{${joined}}` : '';
}

function byClause(breakdown: EvalBreakdownDimension, extraLabels?: string[]): string {
  const labels = [...(extraLabels ?? [])];
  const bl = evalBreakdownToPromLabel[breakdown];
  if (bl) {
    labels.push(bl);
  }
  return labels.length > 0 ? ` by (${labels.join(', ')})` : '';
}

// ---------------------------------------------------------------------------
// Stat panel queries (instant)
// ---------------------------------------------------------------------------

export function totalScoresQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  rangeDuration: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(increase(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters)}[${rangeDuration}]))`;
}

export function passRateQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  rangeDuration: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  const passed = `sum${byClause(breakdown)}(increase(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'passed="true"')}[${rangeDuration}]))`;
  const total = `sum${byClause(breakdown)}(increase(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'passed!="unknown"')}[${rangeDuration}]))`;
  return `(${passed} / ${total}) * 100`;
}

export function totalExecutionsQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  rangeDuration: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(increase(${EXECUTIONS_TOTAL}${evalLabelSelector(dashFilters, evalFilters)}[${rangeDuration}]))`;
}

export function evalDurationStatQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  rangeDuration: string,
  breakdown: EvalBreakdownDimension = 'none',
  quantile = 0.95
): string {
  return `histogram_quantile(${quantile}, sum${byClause(breakdown, ['le'])}(increase(${DURATION_SECONDS}_bucket${evalLabelSelector(dashFilters, evalFilters)}[${rangeDuration}])))`;
}

// ---------------------------------------------------------------------------
// Timeseries queries (range)
// ---------------------------------------------------------------------------

export function scoresOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(rate(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters)}[${interval}]))`;
}

export function passedOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(rate(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'passed="true"')}[${interval}]))`;
}

export function failedOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(rate(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'passed="false"')}[${interval}]))`;
}

export function passRateOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  const passed = `sum${byClause(breakdown)}(rate(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'passed="true"')}[${interval}]))`;
  const total = `sum${byClause(breakdown)}(rate(${SCORES_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'passed!="unknown"')}[${interval}]))`;
  return `(${passed} / ${total}) * 100`;
}

export function evalDurationOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none',
  quantile = 0.95
): string {
  return `histogram_quantile(${quantile}, sum${byClause(breakdown, ['le'])}(rate(${DURATION_SECONDS}_bucket${evalLabelSelector(dashFilters, evalFilters)}[${interval}])))`;
}

export function executionsOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(rate(${EXECUTIONS_TOTAL}${evalLabelSelector(dashFilters, evalFilters)}[${interval}]))`;
}

export function failedExecutionsOverTimeQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `sum${byClause(breakdown)}(rate(${EXECUTIONS_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'status="failed"')}[${interval}]))`;
}

export function executionsIncreaseQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `round(sum${byClause(breakdown)}(increase(${EXECUTIONS_TOTAL}${evalLabelSelector(dashFilters, evalFilters)}[${interval}])))`;
}

export function failedExecutionsIncreaseQuery(
  dashFilters: DashboardFilters,
  evalFilters: EvalFilters,
  interval: string,
  breakdown: EvalBreakdownDimension = 'none'
): string {
  return `round(sum${byClause(breakdown)}(increase(${EXECUTIONS_TOTAL}${evalLabelSelector(dashFilters, evalFilters, 'status="failed"')}[${interval}])))`;
}
