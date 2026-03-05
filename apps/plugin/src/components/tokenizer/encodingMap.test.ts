import { getEncoding, type EncodingName, AVAILABLE_ENCODINGS } from './encodingMap';

describe('getEncoding', () => {
  const cases: Array<{ provider?: string; model?: string; expected: EncodingName }> = [
    { provider: 'openai', model: 'gpt-4o', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-4o-mini', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-5', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-5.2', expected: 'o200k_base' },
    { provider: 'openai', model: 'o1', expected: 'o200k_base' },
    { provider: 'openai', model: 'o3', expected: 'o200k_base' },
    { provider: 'openai', model: 'o4-mini', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-4.1', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-4-turbo', expected: 'cl100k_base' },
    { provider: 'openai', model: 'gpt-4-0613', expected: 'cl100k_base' },
    { provider: 'openai', model: 'gpt-3.5-turbo', expected: 'cl100k_base' },
    { provider: 'openai', model: 'gpt-4', expected: 'cl100k_base' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5', expected: 'cl100k_base' },
    { provider: 'bedrock', model: 'claude-haiku-4-5-20251001', expected: 'cl100k_base' },
    { provider: 'google', model: 'gemini-pro', expected: 'cl100k_base' },
    { provider: undefined, model: undefined, expected: 'cl100k_base' },
  ];

  it.each(cases)('returns $expected for $provider/$model', ({ provider, model, expected }) => {
    expect(getEncoding(provider, model)).toBe(expected);
  });
});

describe('AVAILABLE_ENCODINGS', () => {
  it('contains the expected encodings', () => {
    expect(AVAILABLE_ENCODINGS.map((e) => e.value)).toEqual(expect.arrayContaining(['o200k_base', 'cl100k_base']));
  });
});
