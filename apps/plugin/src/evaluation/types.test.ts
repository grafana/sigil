import {
  buildForkEvaluatorConfig,
  getEffectiveLLMJudgePrompts,
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION,
} from './types';

describe('buildForkEvaluatorConfig', () => {
  it('materializes default judge prompts when a forked template omits them', () => {
    expect(buildForkEvaluatorConfig('llm_judge', { max_tokens: 128, temperature: 0 })).toEqual({
      max_tokens: 128,
      temperature: 0,
      system_prompt: LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
      user_prompt: LLM_JUDGE_DEFAULT_USER_PROMPT,
    });
  });

  it('preserves explicit judge prompts when present', () => {
    expect(
      buildForkEvaluatorConfig('llm_judge', {
        system_prompt: 'Judge strictly',
        user_prompt: 'Input: {{input}}',
      })
    ).toEqual({
      system_prompt: 'Judge strictly',
      user_prompt: 'Input: {{input}}',
    });
  });

  it('does not modify non-judge configs', () => {
    const config = { pattern: '^ok$' };
    expect(buildForkEvaluatorConfig('regex', config)).toEqual(config);
  });

  it('resolves effective judge prompts from defaults when omitted', () => {
    expect(getEffectiveLLMJudgePrompts({})).toEqual({
      systemPrompt: LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
      userPrompt: LLM_JUDGE_DEFAULT_USER_PROMPT,
    });
  });

  it('resolves effective judge prompts from explicit config when present', () => {
    expect(
      getEffectiveLLMJudgePrompts({
        system_prompt: 'Judge strictly',
        user_prompt: 'Latest user message: {{latest_user_message}}',
      })
    ).toEqual({
      systemPrompt: 'Judge strictly',
      userPrompt: 'Latest user message: {{latest_user_message}}',
    });
  });

  it('keeps the judge variable help focused on primary variables and docs', () => {
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).toContain('{{assistant_sequence}}');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).toContain('{{tools}}');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).toContain('{{stop_reason}}');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).toContain('Check the online evaluation docs');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).not.toContain('{{input}}');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).not.toContain('{{output}}');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).not.toContain('{{metadata}}');
    expect(LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION).not.toContain('{{response_model}}');
  });
});
