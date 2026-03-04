import type { ModelCardClient } from './api';
import type { ModelCard } from './types';

const bedrockRegionalPrefixes = new Set(['us', 'eu', 'apac', 'jp', 'global']);

const knownBedrockVendors = new Set(['anthropic', 'amazon', 'cohere', 'meta', 'mistral', 'ai21', 'stability']);

function isBedrockModelID(model: string): boolean {
  const trimmed = model.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }

  const parts = trimmed.split('.');
  if (parts.length < 2) {
    return false;
  }

  let vendorIdx = 0;
  if (parts.length >= 3 && bedrockRegionalPrefixes.has(parts[0])) {
    vendorIdx = 1;
  }
  if (vendorIdx + 1 >= parts.length) {
    return false;
  }

  return knownBedrockVendors.has(parts[vendorIdx]);
}

/**
 * Infers a provider string from a raw model name for use with the resolve API.
 * Mirrors the backend's provider inference logic (Bedrock regional prefixes,
 * known model name prefixes, slash-separated source model IDs).
 */
export function inferProviderFromModelName(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (normalized.length === 0) {
    return '';
  }

  if (normalized.includes('/')) {
    const provider = normalized.split('/')[0];
    if (provider.length > 0) {
      return provider;
    }
  }

  if (isBedrockModelID(normalized)) {
    return 'bedrock';
  }

  if (normalized.startsWith('gemini') || normalized.startsWith('gemma')) {
    return 'google';
  }
  if (normalized.startsWith('claude')) {
    return 'anthropic';
  }
  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'openai';
  }
  if (normalized.startsWith('grok')) {
    return 'x-ai';
  }
  if (normalized.startsWith('llama')) {
    return 'meta-llama';
  }
  if (normalized.startsWith('mistral') || normalized.startsWith('mixtral') || normalized.startsWith('ministral')) {
    return 'mistralai';
  }
  if (normalized.startsWith('command') || normalized.startsWith('embed')) {
    return 'cohere';
  }
  if (normalized.startsWith('nova')) {
    return 'amazon';
  }

  return '';
}

/**
 * Resolves model cards from raw model name strings (e.g., from conversation.models).
 * Uses known providers from the optional providerMap when available,
 * falling back to inference from model name patterns.
 * Returns a map of "provider::model" → ModelCard for resolved models.
 */
export async function resolveModelCardsFromNames(
  modelNames: string[],
  client: ModelCardClient,
  providerMap?: Record<string, string>
): Promise<Map<string, ModelCard>> {
  const cards = new Map<string, ModelCard>();
  if (modelNames.length === 0) {
    return cards;
  }

  const pairs: Array<{ provider: string; model: string; originalName: string }> = [];
  for (const name of modelNames) {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const provider = providerMap?.[trimmed] ?? inferProviderFromModelName(trimmed);
    if (provider.length === 0) {
      continue;
    }
    pairs.push({ provider, model: trimmed, originalName: trimmed });
  }
  if (pairs.length === 0) {
    return cards;
  }

  const resolveResp = await client.resolve(pairs.map((p) => ({ provider: p.provider, model: p.model })));

  const lookupPromises: Array<Promise<void>> = [];

  for (const item of resolveResp.resolved) {
    if (item.status !== 'resolved' || !item.card) {
      continue;
    }
    const key = `${item.provider}::${item.model}`;
    const stubCard: ModelCard = {
      model_key: item.card.model_key,
      source: 'openrouter',
      source_model_id: item.card.source_model_id,
      canonical_slug: '',
      name: item.model,
      provider: item.provider,
      pricing: item.card.pricing,
      is_free: false,
      top_provider: {},
      first_seen_at: '',
      last_seen_at: '',
      refreshed_at: '',
    };
    cards.set(key, stubCard);

    lookupPromises.push(
      client
        .lookup({ modelKey: item.card.model_key })
        .then((lookupResp) => {
          cards.set(key, lookupResp.data);
        })
        .catch(() => {
          // Keep stub card from resolve.
        })
    );
  }

  await Promise.all(lookupPromises);
  return cards;
}
