import { canonicalizeProviderNameForMapping, isCrossProviderMapping } from './useResolvedModelPricing';

describe('useResolvedModelPricing provider mapping helpers', () => {
  it('normalizes known provider aliases', () => {
    expect(canonicalizeProviderNameForMapping('xai')).toBe('x-ai');
    expect(canonicalizeProviderNameForMapping('meta')).toBe('meta-llama');
    expect(canonicalizeProviderNameForMapping('mistral')).toBe('mistralai');
    expect(canonicalizeProviderNameForMapping('azure-openai')).toBe('openai');
    expect(canonicalizeProviderNameForMapping('vertex-ai')).toBe('vertex');
  });

  it('does not mark alias-only differences as cross-provider mapping', () => {
    expect(isCrossProviderMapping('xai', 'x-ai')).toBe(false);
    expect(isCrossProviderMapping('meta', 'meta-llama')).toBe(false);
    expect(isCrossProviderMapping('mistral', 'mistralai')).toBe(false);
    expect(isCrossProviderMapping('azure-openai', 'openai')).toBe(false);
  });

  it('marks true cross-provider mappings', () => {
    expect(isCrossProviderMapping('bedrock', 'anthropic')).toBe(true);
    expect(isCrossProviderMapping('openai', 'anthropic')).toBe(true);
  });
});
