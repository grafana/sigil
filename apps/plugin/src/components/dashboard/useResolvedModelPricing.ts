import { useEffect, useMemo, useState } from 'react';
import type { DashboardDataSource } from '../../dashboard/api';
import { type PricingMap, pricingKey } from '../../dashboard/cost';
import type { ModelCardResolveItem, ModelResolvePair } from '../../dashboard/types';

const RESOLVE_BATCH_SIZE = 50;

type ResolvedModelPricingResult = {
  pricingMap: PricingMap;
  unresolved: ModelCardResolveItem[];
  mapped: Array<{
    provider: string;
    model: string;
    sourceModelID: string;
    targetProvider: string;
    matchStrategy: 'exact' | 'normalized' | undefined;
  }>;
  loading: boolean;
  error: string;
};

const providerCanonicalAliases: Record<string, string> = {
  gemini: 'google',
  google: 'google',
  'google-vertex': 'vertex',
  google_vertex: 'vertex',
  vertex: 'vertex',
  'vertex-ai': 'vertex',
  vertexai: 'vertex',
  bedrock: 'bedrock',
  'aws-bedrock': 'bedrock',
  'amazon-bedrock': 'bedrock',
  amazon_bedrock: 'bedrock',
  openai: 'openai',
  'azure-openai': 'openai',
  azure_openai: 'openai',
  azureopenai: 'openai',
  azure: 'openai',
  xai: 'x-ai',
  'x-ai': 'x-ai',
  meta: 'meta-llama',
  'meta-llama': 'meta-llama',
  mistral: 'mistralai',
  mistralai: 'mistralai',
  cohere: 'cohere',
  'cohere-ai': 'cohere',
};

export function canonicalizeProviderNameForMapping(provider: string): string {
  const normalizedProvider = provider.trim().toLowerCase();
  if (!normalizedProvider) {
    return '';
  }
  return providerCanonicalAliases[normalizedProvider] ?? normalizedProvider;
}

export function isCrossProviderMapping(sourceProvider: string, targetProvider: string): boolean {
  const normalizedSourceProvider = canonicalizeProviderNameForMapping(sourceProvider);
  const normalizedTargetProvider = canonicalizeProviderNameForMapping(targetProvider);
  if (!normalizedSourceProvider || !normalizedTargetProvider) {
    return false;
  }
  return normalizedSourceProvider !== normalizedTargetProvider;
}

function providerFromSourceModelID(sourceModelID: string): string {
  const trimmed = sourceModelID.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  const slash = trimmed.indexOf('/');
  if (slash <= 0) {
    return '';
  }
  return trimmed.slice(0, slash);
}

export function useResolvedModelPricing(
  dataSource: DashboardDataSource,
  pairs: ModelResolvePair[]
): ResolvedModelPricingResult {
  const dedupedPairs = useMemo(() => {
    const seen = new Set<string>();
    const unique: ModelResolvePair[] = [];
    for (const pair of pairs) {
      const provider = pair.provider.trim().toLowerCase();
      const model = pair.model.trim();
      if (!provider || !model) {
        continue;
      }
      const key = pricingKey(provider, model);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push({ provider, model });
    }
    return unique;
  }, [pairs]);

  const [pricingMap, setPricingMap] = useState<PricingMap>(new Map());
  const [unresolved, setUnresolved] = useState<ModelCardResolveItem[]>([]);
  const [mapped, setMapped] = useState<ResolvedModelPricingResult['mapped']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dedupedPairs.length === 0) {
      setPricingMap(new Map());
      setUnresolved([]);
      setMapped([]);
      setLoading(false);
      setError('');
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');

      const nextPricingMap: PricingMap = new Map();
      const nextUnresolved: ModelCardResolveItem[] = [];
      const nextMapped = new Map<string, ResolvedModelPricingResult['mapped'][number]>();

      try {
        for (let i = 0; i < dedupedPairs.length; i += RESOLVE_BATCH_SIZE) {
          const batch = dedupedPairs.slice(i, i + RESOLVE_BATCH_SIZE);
          const response = await dataSource.resolveModelCards(batch);
          for (const item of response.resolved ?? []) {
            if (item.status === 'resolved' && item.card) {
              nextPricingMap.set(pricingKey(item.provider, item.model), item.card.pricing);
              const sourceProvider = item.provider.trim().toLowerCase();
              const targetProvider = providerFromSourceModelID(item.card.source_model_id);
              if (isCrossProviderMapping(sourceProvider, targetProvider)) {
                const mappingKey = `${sourceProvider}::${item.model.trim()}::${item.card.source_model_id.trim()}`;
                nextMapped.set(mappingKey, {
                  provider: item.provider,
                  model: item.model,
                  sourceModelID: item.card.source_model_id,
                  targetProvider,
                  matchStrategy: item.match_strategy,
                });
              }
              continue;
            }
            nextUnresolved.push(item);
          }
        }

        if (cancelled) {
          return;
        }
        setPricingMap(nextPricingMap);
        setUnresolved(nextUnresolved);
        setMapped(Array.from(nextMapped.values()));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setPricingMap(new Map());
        setUnresolved([]);
        setMapped([]);
        setError(err instanceof Error ? err.message : 'Failed to resolve model pricing');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [dataSource, dedupedPairs]);

  return { pricingMap, unresolved, mapped, loading, error };
}
