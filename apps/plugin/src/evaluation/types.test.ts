import { buildForkEvaluatorConfig, LLM_JUDGE_DEFAULT_SYSTEM_PROMPT, LLM_JUDGE_DEFAULT_USER_PROMPT } from './types';

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
});
