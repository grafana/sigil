import { getProviderColor, toDisplayProvider } from './providerMeta';

describe('providerMeta', () => {
  it('maps regional provider prefixes to vendor providers for display', () => {
    expect(toDisplayProvider('us.anthropic')).toBe('anthropic');
    expect(toDisplayProvider('eu.mistralai')).toBe('mistral');
  });

  it('returns a non-grey color for known providers after normalization', () => {
    expect(getProviderColor(toDisplayProvider('us.anthropic'))).toBe('#d97757');
    expect(getProviderColor(toDisplayProvider('bedrock'))).toBe('#ff9900');
  });
});
