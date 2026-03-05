export type EncodingName = 'o200k_base' | 'cl100k_base' | 'p50k_base' | 'r50k_base';

export const AVAILABLE_ENCODINGS: Array<{ label: string; value: EncodingName }> = [
  { label: 'o200k (GPT-4o, GPT-5, o1–o4)', value: 'o200k_base' },
  { label: 'cl100k (GPT-4, GPT-3.5, Claude approx)', value: 'cl100k_base' },
  { label: 'p50k (Codex, text-davinci)', value: 'p50k_base' },
  { label: 'r50k (GPT-3)', value: 'r50k_base' },
];

export function getEncoding(provider?: string, model?: string): EncodingName {
  const p = provider?.trim().toLowerCase() ?? '';
  const m = model?.trim().toLowerCase() ?? '';

  if (p === 'openai') {
    // Legacy cl100k models: gpt-4 (non-o, non-4.x), gpt-3.5
    if (/^gpt-4($|[^o.])/.test(m) || m.startsWith('gpt-3.5')) {
      return 'cl100k_base';
    }
    return 'o200k_base';
  }

  return 'cl100k_base';
}
