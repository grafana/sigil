export type ProviderMeta = {
  label: string;
  color: string;
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: { label: 'OpenAI', color: '#10a37f' },
  anthropic: { label: 'Anthropic', color: '#d97757' },
  google: { label: 'Google', color: '#4285f4' },
  gemini: { label: 'Google', color: '#4285f4' },
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

const MODEL_NAME_PATTERNS: [RegExp, string][] = [
  [/^claude/i, 'anthropic'],
  [/^gpt|^o[1-9]|^chatgpt/i, 'openai'],
  [/^gemini|^palm/i, 'google'],
  [/^llama|^codellama/i, 'meta'],
  [/^mistral|^mixtral|^codestral|^pixtral/i, 'mistral'],
  [/^command|^embed.*cohere/i, 'cohere'],
  [/^deepseek/i, 'deepseek'],
];

export function inferProvider(modelName: string): string {
  for (const [pattern, provider] of MODEL_NAME_PATTERNS) {
    if (pattern.test(modelName)) {
      return provider;
    }
  }
  return '';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripProviderPrefix(displayName: string, prefix: string): string {
  return displayName.replace(new RegExp(`^${escapeRegExp(prefix)}[:/]\\s*`, 'i'), '');
}
