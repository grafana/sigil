import { getProviderColor, toDisplayProvider } from './providerMeta';

describe('providerMeta', () => {
  it('maps regional bedrock provider prefixes to vendor display providers', () => {
    expect(toDisplayProvider('us.anthropic')).toBe('anthropic');
    expect(toDisplayProvider('eu.mistralai')).toBe('mistral');
  });

  it('returns provider colors for mapped providers', () => {
    expect(getProviderColor(toDisplayProvider('us.anthropic'))).toBe('#d97757');
    expect(getProviderColor(toDisplayProvider('bedrock'))).toBe('#ff9900');
  });
});
