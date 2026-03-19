import { validateJudgeTarget, validateSharedForm } from './formValidation';
import { createDefaultHeuristicQuery } from './heuristicConfig';
import { LLM_JUDGE_MIN_MAX_TOKENS, LLM_JUDGE_MAX_MAX_TOKENS } from './types';

describe('validateSharedForm', () => {
  const baseInput = {
    kind: 'llm_judge' as const,
    outputKey: 'score',
    provider: '',
    model: '',
    pattern: '',
    maxTokens: LLM_JUDGE_MIN_MAX_TOKENS,
    temperature: 0,
    schemaJson: '{}',
    heuristicQuery: createDefaultHeuristicQuery(),
    output: {
      type: 'number' as const,
      passThreshold: '' as number | '',
      min: '' as number | '',
      max: '' as number | '',
    },
  };

  it('requires provider and model together when overriding llm_judge defaults', () => {
    expect(validateSharedForm({ ...baseInput, provider: 'openai' }).judgeTargetError).toBe(
      'Choose both provider and model, or leave both blank'
    );
    expect(validateSharedForm({ ...baseInput, model: 'gpt-4o-mini' }).judgeTargetError).toBe(
      'Choose both provider and model, or use a fully-qualified model like provider/model'
    );
  });

  it('accepts a fully-qualified model without a provider', () => {
    const result = validateSharedForm({ ...baseInput, model: 'openai/gpt-4o-mini' });
    expect(result.judgeTargetError).toBeUndefined();
    expect(result.hasErrors).toBe(false);
  });

  it('accepts both provider and model together', () => {
    const result = validateSharedForm({ ...baseInput, provider: 'openai', model: 'gpt-4o-mini' });
    expect(result.judgeTargetError).toBeUndefined();
    expect(result.hasErrors).toBe(false);
  });

  it('accepts leaving both provider and model blank', () => {
    const result = validateSharedForm(baseInput);
    expect(result.judgeTargetError).toBeUndefined();
    expect(result.hasErrors).toBe(false);
  });

  it('rejects max_tokens below minimum', () => {
    const result = validateSharedForm({ ...baseInput, maxTokens: 128 });
    expect(result.maxTokensError).toBe(
      `Must be an integer between ${LLM_JUDGE_MIN_MAX_TOKENS} and ${LLM_JUDGE_MAX_MAX_TOKENS}`
    );
    expect(result.hasErrors).toBe(true);
  });

  it('rejects max_tokens above maximum', () => {
    const result = validateSharedForm({ ...baseInput, maxTokens: 2048 });
    expect(result.maxTokensError).toBe(
      `Must be an integer between ${LLM_JUDGE_MIN_MAX_TOKENS} and ${LLM_JUDGE_MAX_MAX_TOKENS}`
    );
    expect(result.hasErrors).toBe(true);
  });

  it('accepts max_tokens at minimum', () => {
    const result = validateSharedForm({ ...baseInput, maxTokens: LLM_JUDGE_MIN_MAX_TOKENS });
    expect(result.maxTokensError).toBeUndefined();
  });

  it('accepts max_tokens at maximum', () => {
    const result = validateSharedForm({ ...baseInput, maxTokens: LLM_JUDGE_MAX_MAX_TOKENS });
    expect(result.maxTokensError).toBeUndefined();
  });

  it('rejects pass threshold values above max', () => {
    const result = validateSharedForm({
      ...baseInput,
      output: {
        type: 'number',
        passThreshold: 11,
        min: 1,
        max: 10,
      },
    });

    expect(result.passThresholdError).toBe('Must be less than or equal to Max');
    expect(result.hasErrors).toBe(true);
  });

  it('validates standalone judge target shapes consistently', () => {
    expect(validateJudgeTarget('', '')).toBeUndefined();
    expect(validateJudgeTarget('openai', 'gpt-4o-mini')).toBeUndefined();
    expect(validateJudgeTarget('', 'openai/gpt-4o-mini')).toBeUndefined();
    expect(validateJudgeTarget('', 'gpt-4o-mini')).toBe(
      'Choose both provider and model, or use a fully-qualified model like provider/model'
    );
  });
});
