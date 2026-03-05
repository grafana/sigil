export type ProviderMeta = {
  label: string;
  color: string;
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: { label: 'OpenAI', color: '#10a37f' },
  anthropic: { label: 'Anthropic', color: '#d97757' },
  google: { label: 'Google', color: '#4285f4' },
  gemini: { label: 'Google', color: '#4285f4' },
  bedrock: { label: 'Bedrock', color: '#ff9900' },
  meta: { label: 'Meta', color: '#0668E1' },
  mistral: { label: 'Mistral', color: '#F54E42' },
  cohere: { label: 'Cohere', color: '#39594D' },
  deepseek: { label: 'DeepSeek', color: '#4D6BFE' },
};

const DEFAULT_META: ProviderMeta = { label: 'Unknown', color: '#888888' };

export function getProviderMeta(provider: string): ProviderMeta {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_META[normalized] ?? { label: provider || DEFAULT_META.label, color: DEFAULT_META.color };
}

export function getProviderColor(provider: string): string {
  return getProviderMeta(provider).color;
}

const API_TO_DISPLAY_PROVIDER: Record<string, string> = {
  'meta-llama': 'meta',
  mistralai: 'mistral',
};

export function toDisplayProvider(apiProvider: string): string {
  const normalized = apiProvider.trim().toLowerCase();
  const parts = normalized.split('.').filter((part) => part.length > 0);
  if (parts.length >= 2) {
    const regionalPrefixes = new Set(['us', 'eu', 'apac', 'jp', 'global']);
    if (regionalPrefixes.has(parts[0])) {
      return API_TO_DISPLAY_PROVIDER[parts[1]] || parts[1];
    }
  }
  return API_TO_DISPLAY_PROVIDER[normalized] || normalized;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripProviderPrefix(displayName: string, prefix: string): string {
  return displayName.replace(new RegExp(`^${escapeRegExp(prefix)}[:/]\\s*`, 'i'), '');
}
