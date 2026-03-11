import {
  buildCascadingSelector,
  buildLabelSelector,
  buildScopedLabelMatcher,
  computeStep,
  computeRateInterval,
  computeRangeDuration,
  totalOpsQuery,
  totalErrorsQuery,
  errorRateQuery,
  latencyStatQuery,
  tokensByModelAndTypeQuery,
  totalTokensQuery,
  totalTokensOverTimeQuery,
  requestsSuccessOverTimeQuery,
  requestsErrorOverTimeQuery,
  requestsOverTimeQuery,
  errorRateOverTimeQuery,
  errorsByCodeOverTimeQuery,
  errorsBySpecificCodeOverTimeQuery,
  latencyP95OverTimeQuery,
  latencyP99OverTimeQuery,
  latencyP50OverTimeQuery,
  latencyOverTimeQuery,
  tokensByModelAndTypeOverTimeQuery,
} from './queries';
import type { DashboardFilters } from './types';

const empty: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

describe('buildCascadingSelector', () => {
  it('returns undefined when all label arrays are empty', () => {
    expect(buildCascadingSelector({ gen_ai_provider_name: [] })).toBeUndefined();
  });

  it('uses exact match for a single value', () => {
    expect(buildCascadingSelector({ gen_ai_provider_name: ['openai'] })).toBe('{gen_ai_provider_name="openai"}');
  });

  it('joins multiple values with =~ and escapes regex metacharacters', () => {
    expect(buildCascadingSelector({ gen_ai_provider_name: ['us.anthropic', 'openai'] })).toBe(
      '{gen_ai_provider_name=~"us[.]anthropic|openai"}'
    );
  });

  it('combines multiple labels', () => {
    expect(
      buildCascadingSelector({
        gen_ai_provider_name: ['openai'],
        gen_ai_request_model: ['gpt-4o', 'gpt-4o(mini)'],
      })
    ).toBe('{gen_ai_provider_name="openai",gen_ai_request_model=~"gpt-4o|gpt-4o\\(mini\\)"}');
  });

  it('skips empty arrays in multi-label input', () => {
    expect(
      buildCascadingSelector({
        gen_ai_provider_name: ['openai'],
        gen_ai_request_model: [],
      })
    ).toBe('{gen_ai_provider_name="openai"}');
  });

  it('escapes pipe characters in values', () => {
    expect(buildCascadingSelector({ gen_ai_provider_name: ['a|b', 'c'] })).toBe('{gen_ai_provider_name=~"a\\|b|c"}');
  });
});

describe('buildLabelSelector', () => {
  it('returns empty string for empty filters', () => {
    expect(buildLabelSelector(empty)).toBe('');
  });

  it('builds fuzzy selector for single filter', () => {
    expect(buildLabelSelector({ ...empty, providers: ['openai'] })).toBe('gen_ai_provider_name=~"(?i).*openai.*"');
  });

  it('builds fuzzy selector for multiple filters', () => {
    expect(buildLabelSelector({ ...empty, providers: ['openai'], models: ['gpt-4o'], agentNames: ['my-agent'] })).toBe(
      'gen_ai_provider_name=~"(?i).*openai.*",gen_ai_request_model=~"(?i).*gpt-4o.*",gen_ai_agent_name=~"(?i).*my-agent.*"'
    );
  });

  it('escapes regex metacharacters in filter values', () => {
    expect(buildLabelSelector({ ...empty, providers: ['openai(v2)+'] })).toBe(
      'gen_ai_provider_name=~"(?i).*openai\\(v2\\)\\+.*"'
    );
  });

  it('builds fuzzy selector for multiple values in one dimension', () => {
    expect(buildLabelSelector({ ...empty, providers: ['openai', 'anthropic'] })).toBe(
      'gen_ai_provider_name=~"(?i).*openai.*|.*anthropic.*"'
    );
  });

  it('builds fuzzy selector for multiple values with special characters', () => {
    expect(buildLabelSelector({ ...empty, models: ['gpt-4o', 'claude-3.5'] })).toBe(
      'gen_ai_request_model=~"(?i).*gpt-4o.*|.*claude-3[.]5.*"'
    );
  });

  it('escapes dots as [.] for RE2 compatibility (Prometheus rejects \\.)', () => {
    expect(buildLabelSelector({ ...empty, models: ['us.anthropic.claude-haiku-4-5-20251001-v1:0'] })).toBe(
      'gen_ai_request_model=~"(?i).*us[.]anthropic[.]claude-haiku-4-5-20251001-v1:0.*"'
    );
  });

  it('supports exact matching on arbitrary label key with = operator', () => {
    expect(
      buildLabelSelector({ ...empty, labelFilters: [{ key: 'service_name', operator: '=', value: 'sigil-api' }] })
    ).toBe('service_name="sigil-api"');
  });

  it('supports regex matching with =~ operator', () => {
    expect(
      buildLabelSelector({ ...empty, labelFilters: [{ key: 'service_name', operator: '=~', value: 'sigil.*' }] })
    ).toBe('service_name=~"sigil.*"');
  });

  it('supports != operator', () => {
    expect(buildLabelSelector({ ...empty, labelFilters: [{ key: 'env', operator: '!=', value: 'dev' }] })).toBe(
      'env!="dev"'
    );
  });

  it('supports multiple label filters with different operators', () => {
    expect(
      buildLabelSelector({
        ...empty,
        labelFilters: [
          { key: 'service_name', operator: '=', value: 'sigil-api' },
          { key: 'env', operator: '!=', value: 'dev' },
        ],
      })
    ).toBe('service_name="sigil-api",env!="dev"');
  });

  it('falls back to fuzzy match for numeric comparison operators', () => {
    expect(
      buildLabelSelector({ ...empty, labelFilters: [{ key: 'service_name', operator: '<', value: 'sigil-api' }] })
    ).toBe('service_name=~"(?i).*sigil-api.*"');
  });

  it('ignores invalid arbitrary label keys', () => {
    expect(
      buildLabelSelector({ ...empty, labelFilters: [{ key: 'service.name', operator: '=', value: 'sigil-api' }] })
    ).toBe('');
  });

  it('ignores label key without label value', () => {
    expect(buildLabelSelector({ ...empty, labelFilters: [{ key: 'service_name', operator: '=', value: '' }] })).toBe(
      ''
    );
  });
});

describe('buildScopedLabelMatcher', () => {
  it('returns undefined when no filters are active', () => {
    expect(buildScopedLabelMatcher(empty)).toBeUndefined();
  });

  it('uses complete label filters from draft rows', () => {
    expect(
      buildScopedLabelMatcher(empty, [
        { key: 'service_name', operator: '=', value: 'sigil-api' },
        { key: 'env', operator: '=', value: '' },
      ])
    ).toBe('service_name="sigil-api"');
  });

  it('excludes the edited row from the scoped matcher', () => {
    expect(
      buildScopedLabelMatcher(
        { ...empty, providers: ['openai'] },
        [
          { key: 'service_name', operator: '=', value: 'sigil-api' },
          { key: 'deployment', operator: '=', value: 'blue' },
        ],
        [1]
      )
    ).toBe('gen_ai_provider_name=~"(?i).*openai.*",service_name="sigil-api"');
  });
});

describe('computeStep', () => {
  it('returns minimum of 60 for short ranges', () => {
    expect(computeStep(0, 100)).toBe(60);
  });

  it('computes step for longer ranges', () => {
    expect(computeStep(0, 3600)).toBe(60);
    expect(computeStep(0, 86400)).toBe(345);
  });
});

describe('computeRateInterval', () => {
  it('returns at least 60s', () => {
    expect(computeRateInterval(10)).toBe('60s');
  });

  it('returns 4x step when larger than 60s', () => {
    expect(computeRateInterval(30)).toBe('120s');
  });
});

describe('computeRangeDuration', () => {
  it('returns difference as seconds string', () => {
    expect(computeRangeDuration(1000, 2000)).toBe('1000s');
  });
});

describe('stat query builders', () => {
  const noFilters: DashboardFilters = empty;
  const withFilters: DashboardFilters = { ...empty, providers: ['openai'] };

  it('totalOpsQuery without filters', () => {
    expect(totalOpsQuery(noFilters, '3600s')).toBe(
      'sum(increase(gen_ai_client_operation_duration_seconds_count[3600s]))'
    );
  });

  it('totalOpsQuery with filters', () => {
    expect(totalOpsQuery(withFilters, '3600s')).toBe(
      'sum(increase(gen_ai_client_operation_duration_seconds_count{gen_ai_provider_name=~"(?i).*openai.*"}[3600s]))'
    );
  });

  it('totalOpsQuery with provider breakdown', () => {
    expect(totalOpsQuery(noFilters, '3600s', 'provider')).toBe(
      'sum by (gen_ai_provider_name)(increase(gen_ai_client_operation_duration_seconds_count[3600s]))'
    );
  });

  it('totalErrorsQuery', () => {
    expect(totalErrorsQuery(noFilters, '3600s')).toBe(
      'sum(increase(gen_ai_client_operation_duration_seconds_count{error_type!=""}[3600s]))'
    );
  });

  it('errorRateQuery', () => {
    const q = errorRateQuery(noFilters, '3600s');
    expect(q).toContain('error_type!=""');
    expect(q).toContain('* 100');
  });

  it('errorRateQuery with model breakdown', () => {
    const q = errorRateQuery(noFilters, '3600s', 'model');
    expect(q).toContain('sum by (gen_ai_request_model)');
    expect(q).toContain('* 100');
  });

  it('latencyStatQuery defaults to P95', () => {
    const q = latencyStatQuery(noFilters, '3600s');
    expect(q).toContain('histogram_quantile(0.95');
    expect(q).toContain('gen_ai_client_operation_duration_seconds_bucket');
  });

  it('latencyStatQuery with custom quantile', () => {
    const q = latencyStatQuery(noFilters, '3600s', 'none', 0.99);
    expect(q).toContain('histogram_quantile(0.99');
  });

  it('latencyStatQuery with agent breakdown', () => {
    const q = latencyStatQuery(noFilters, '3600s', 'agent');
    expect(q).toContain('sum by (le, gen_ai_agent_name)');
  });

  it('tokensByModelAndTypeQuery', () => {
    expect(tokensByModelAndTypeQuery(noFilters, '3600s')).toBe(
      'sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type) (increase(gen_ai_client_token_usage_sum[3600s]))'
    );
  });

  it('tokensByModelAndTypeQuery with agent breakdown adds agent label', () => {
    expect(tokensByModelAndTypeQuery(noFilters, '3600s', 'agent')).toBe(
      'sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type, gen_ai_agent_name) (increase(gen_ai_client_token_usage_sum[3600s]))'
    );
  });

  it('totalTokensQuery without breakdown', () => {
    expect(totalTokensQuery(noFilters, '3600s')).toBe('sum(increase(gen_ai_client_token_usage_sum[3600s]))');
  });

  it('totalTokensQuery with provider breakdown', () => {
    expect(totalTokensQuery(noFilters, '3600s', 'provider')).toBe(
      'sum by (gen_ai_provider_name)(increase(gen_ai_client_token_usage_sum[3600s]))'
    );
  });
});

describe('timeseries query builders', () => {
  const noFilters: DashboardFilters = empty;

  it('requestsSuccessOverTimeQuery', () => {
    expect(requestsSuccessOverTimeQuery(noFilters, '60s')).toBe(
      'sum(rate(gen_ai_client_operation_duration_seconds_count{error_type=""}[60s]))'
    );
  });

  it('requestsErrorOverTimeQuery', () => {
    expect(requestsErrorOverTimeQuery(noFilters, '60s')).toBe(
      'sum(rate(gen_ai_client_operation_duration_seconds_count{error_type!=""}[60s]))'
    );
  });

  it('requestsOverTimeQuery without breakdown', () => {
    expect(requestsOverTimeQuery(noFilters, '60s', 'none')).toBe(
      'sum(rate(gen_ai_client_operation_duration_seconds_count[60s]))'
    );
  });

  it('requestsOverTimeQuery with provider breakdown', () => {
    expect(requestsOverTimeQuery(noFilters, '60s', 'provider')).toBe(
      'sum by (gen_ai_provider_name)(rate(gen_ai_client_operation_duration_seconds_count[60s]))'
    );
  });

  it('errorRateOverTimeQuery', () => {
    const q = errorRateOverTimeQuery(noFilters, '60s', 'none');
    expect(q).toContain('error_type!=""');
    expect(q).toContain('* 100');
  });

  it('errorsByCodeOverTimeQuery without breakdown', () => {
    const q = errorsByCodeOverTimeQuery(noFilters, '60s', 'none');
    expect(q).toContain(
      'sum by (error_type)(rate(gen_ai_client_operation_duration_seconds_count{error_type!=""}[60s]))'
    );
    expect(q).toContain('/ scalar(');
    expect(q).toContain('* 100');
  });

  it('errorsByCodeOverTimeQuery with breakdown', () => {
    const q = errorsByCodeOverTimeQuery(noFilters, '60s', 'provider');
    expect(q).toContain(
      'sum by (error_type, gen_ai_provider_name)(rate(gen_ai_client_operation_duration_seconds_count{error_type!=""}[60s]))'
    );
    expect(q).toContain('* 100');
  });

  it('errorsBySpecificCodeOverTimeQuery without breakdown', () => {
    expect(errorsBySpecificCodeOverTimeQuery(noFilters, '60s', 'none', 'TIMEOUT')).toBe(
      'sum(rate(gen_ai_client_operation_duration_seconds_count{error_type="TIMEOUT"}[60s]))'
    );
  });

  it('errorsBySpecificCodeOverTimeQuery with breakdown', () => {
    expect(errorsBySpecificCodeOverTimeQuery(noFilters, '60s', 'provider', 'TIMEOUT')).toBe(
      'sum by (gen_ai_provider_name)(rate(gen_ai_client_operation_duration_seconds_count{error_type="TIMEOUT"}[60s]))'
    );
  });

  it('latencyP95OverTimeQuery without breakdown', () => {
    const q = latencyP95OverTimeQuery(noFilters, '60s', 'none');
    expect(q).toContain('histogram_quantile(0.95');
    expect(q).toContain('sum by (le)');
  });

  it('latencyP95OverTimeQuery with breakdown', () => {
    const q = latencyP95OverTimeQuery(noFilters, '60s', 'model');
    expect(q).toContain('sum by (le, gen_ai_request_model)');
  });

  it('latencyP99OverTimeQuery', () => {
    const q = latencyP99OverTimeQuery(noFilters, '60s', 'none');
    expect(q).toContain('histogram_quantile(0.99');
    expect(q).toContain('sum by (le)');
  });

  it('latencyP50OverTimeQuery', () => {
    const q = latencyP50OverTimeQuery(noFilters, '60s', 'none');
    expect(q).toContain('histogram_quantile(0.5');
  });

  it('latencyOverTimeQuery with custom quantile', () => {
    const q = latencyOverTimeQuery(noFilters, '60s', 'none', 0.75);
    expect(q).toContain('histogram_quantile(0.75');
  });

  it('tokensByModelAndTypeOverTimeQuery without breakdown', () => {
    expect(tokensByModelAndTypeOverTimeQuery(noFilters, '60s')).toBe(
      'sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type) (rate(gen_ai_client_token_usage_sum[60s]))'
    );
  });

  it('tokensByModelAndTypeOverTimeQuery with agent breakdown adds agent label', () => {
    expect(tokensByModelAndTypeOverTimeQuery(noFilters, '60s', 'agent')).toBe(
      'sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type, gen_ai_agent_name) (rate(gen_ai_client_token_usage_sum[60s]))'
    );
  });

  it('tokensByModelAndTypeOverTimeQuery with provider breakdown does not duplicate provider label', () => {
    expect(tokensByModelAndTypeOverTimeQuery(noFilters, '60s', 'provider')).toBe(
      'sum by (gen_ai_provider_name, gen_ai_request_model, gen_ai_token_type) (rate(gen_ai_client_token_usage_sum[60s]))'
    );
  });

  it('totalTokensOverTimeQuery without breakdown', () => {
    expect(totalTokensOverTimeQuery(noFilters, '60s')).toBe('sum(rate(gen_ai_client_token_usage_sum[60s]))');
  });

  it('totalTokensOverTimeQuery with model breakdown', () => {
    expect(totalTokensOverTimeQuery(noFilters, '60s', 'model')).toBe(
      'sum by (gen_ai_request_model)(rate(gen_ai_client_token_usage_sum[60s]))'
    );
  });
});
