import type { DashboardFilters } from '../dashboard/types';
import {
  type EvalFilters,
  totalScoresQuery,
  passRateQuery,
  totalExecutionsQuery,
  evalDurationStatQuery,
  scoresOverTimeQuery,
  passedOverTimeQuery,
  failedOverTimeQuery,
  passRateOverTimeQuery,
  evalDurationOverTimeQuery,
  executionsOverTimeQuery,
  failedExecutionsOverTimeQuery,
  executionsIncreaseQuery,
  failedExecutionsIncreaseQuery,
  emptyEvalFilters,
} from './queries';

const noFilters: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

const noEval: EvalFilters = emptyEvalFilters;

const withDashFilters: DashboardFilters = { ...noFilters, models: ['gpt-4o'] };

const withEvalFilters: EvalFilters = { evaluators: ['helpfulness'], scoreKeys: [], evaluatorKinds: [] };
const withMultiEvalFilters: EvalFilters = {
  evaluators: ['helpfulness', 'safety'],
  scoreKeys: ['score'],
  evaluatorKinds: ['llm_judge'],
};

describe('eval stat queries', () => {
  it('totalScoresQuery without filters', () => {
    expect(totalScoresQuery(noFilters, noEval, '3600s')).toBe('sum(increase(sigil_eval_scores_total[3600s]))');
  });

  it('totalScoresQuery with eval filters', () => {
    expect(totalScoresQuery(noFilters, withEvalFilters, '3600s')).toBe(
      'sum(increase(sigil_eval_scores_total{evaluator="helpfulness"}[3600s]))'
    );
  });

  it('totalScoresQuery with dashboard and eval filters', () => {
    expect(totalScoresQuery(withDashFilters, withEvalFilters, '3600s')).toBe(
      'sum(increase(sigil_eval_scores_total{gen_ai_request_model=~"(?i).*gpt-4o.*",evaluator="helpfulness"}[3600s]))'
    );
  });

  it('totalScoresQuery with evaluator breakdown', () => {
    expect(totalScoresQuery(noFilters, noEval, '3600s', 'evaluator')).toBe(
      'sum by (evaluator)(increase(sigil_eval_scores_total[3600s]))'
    );
  });

  it('totalScoresQuery with multiple eval filters', () => {
    expect(totalScoresQuery(noFilters, withMultiEvalFilters, '3600s')).toBe(
      'sum(increase(sigil_eval_scores_total{evaluator=~"helpfulness|safety",score_key="score",evaluator_kind="llm_judge"}[3600s]))'
    );
  });

  it('passRateQuery', () => {
    const q = passRateQuery(noFilters, noEval, '3600s');
    expect(q).toContain('passed="true"');
    expect(q).toContain('passed!="unknown"');
    expect(q).toContain('* 100');
  });

  it('passRateQuery with evaluator breakdown', () => {
    const q = passRateQuery(noFilters, noEval, '3600s', 'evaluator');
    expect(q).toContain('sum by (evaluator)');
    expect(q).toContain('* 100');
  });

  it('totalExecutionsQuery', () => {
    expect(totalExecutionsQuery(noFilters, noEval, '3600s')).toBe('sum(increase(sigil_eval_executions_total[3600s]))');
  });

  it('evalDurationStatQuery defaults to P95', () => {
    const q = evalDurationStatQuery(noFilters, noEval, '3600s');
    expect(q).toContain('histogram_quantile(0.95');
    expect(q).toContain('sigil_eval_duration_seconds_bucket');
  });

  it('evalDurationStatQuery with custom quantile', () => {
    const q = evalDurationStatQuery(noFilters, noEval, '3600s', 'none', 0.5);
    expect(q).toContain('histogram_quantile(0.5');
  });

  it('evalDurationStatQuery with breakdown', () => {
    const q = evalDurationStatQuery(noFilters, noEval, '3600s', 'evaluator');
    expect(q).toContain('sum by (le, evaluator)');
  });
});

describe('eval timeseries queries', () => {
  it('scoresOverTimeQuery without breakdown', () => {
    expect(scoresOverTimeQuery(noFilters, noEval, '60s')).toBe('sum(rate(sigil_eval_scores_total[60s]))');
  });

  it('scoresOverTimeQuery with score_key breakdown', () => {
    expect(scoresOverTimeQuery(noFilters, noEval, '60s', 'score_key')).toBe(
      'sum by (score_key)(rate(sigil_eval_scores_total[60s]))'
    );
  });

  it('passedOverTimeQuery', () => {
    const q = passedOverTimeQuery(noFilters, noEval, '60s');
    expect(q).toContain('passed="true"');
  });

  it('failedOverTimeQuery', () => {
    const q = failedOverTimeQuery(noFilters, noEval, '60s');
    expect(q).toContain('passed="false"');
  });

  it('passRateOverTimeQuery', () => {
    const q = passRateOverTimeQuery(noFilters, noEval, '60s');
    expect(q).toContain('passed="true"');
    expect(q).toContain('passed!="unknown"');
    expect(q).toContain('* 100');
  });

  it('passRateOverTimeQuery with model breakdown', () => {
    const q = passRateOverTimeQuery(noFilters, noEval, '60s', 'model');
    expect(q).toContain('sum by (gen_ai_request_model)');
  });

  it('evalDurationOverTimeQuery', () => {
    const q = evalDurationOverTimeQuery(noFilters, noEval, '60s');
    expect(q).toContain('histogram_quantile(0.95');
    expect(q).toContain('sigil_eval_duration_seconds_bucket');
  });

  it('evalDurationOverTimeQuery with evaluator breakdown', () => {
    const q = evalDurationOverTimeQuery(noFilters, noEval, '60s', 'evaluator');
    expect(q).toContain('sum by (le, evaluator)');
  });

  it('executionsOverTimeQuery', () => {
    expect(executionsOverTimeQuery(noFilters, noEval, '60s')).toBe('sum(rate(sigil_eval_executions_total[60s]))');
  });

  it('failedExecutionsOverTimeQuery', () => {
    const q = failedExecutionsOverTimeQuery(noFilters, noEval, '60s');
    expect(q).toContain('status="failed"');
  });

  it('executionsIncreaseQuery', () => {
    expect(executionsIncreaseQuery(noFilters, noEval, '60s')).toBe(
      'round(sum(increase(sigil_eval_executions_total[60s])))'
    );
  });

  it('failedExecutionsIncreaseQuery', () => {
    const q = failedExecutionsIncreaseQuery(noFilters, noEval, '60s');
    expect(q).toContain('round(');
    expect(q).toContain('increase(');
    expect(q).toContain('status="failed"');
  });

  it('queries respect both dashboard and eval filters', () => {
    const q = scoresOverTimeQuery(withDashFilters, withEvalFilters, '60s');
    expect(q).toContain('gen_ai_request_model=~"(?i).*gpt-4o.*"');
    expect(q).toContain('evaluator="helpfulness"');
  });
});
