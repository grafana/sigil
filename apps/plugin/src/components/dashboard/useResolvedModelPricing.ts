import { useEffect, useMemo, useState } from 'react';
import type { DashboardDataSource } from '../../dashboard/api';
import { type PricingMap, pricingKey } from '../../dashboard/cost';
import type { ModelCardResolveItem, ModelResolvePair } from '../../dashboard/types';

const RESOLVE_BATCH_SIZE = 50;

type ResolvedModelPricingResult = {
  pricingMap: PricingMap;
  unresolved: ModelCardResolveItem[];
  loading: boolean;
  error: string;
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dedupedPairs.length === 0) {
      setPricingMap(new Map());
      setUnresolved([]);
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

      try {
        for (let i = 0; i < dedupedPairs.length; i += RESOLVE_BATCH_SIZE) {
          const batch = dedupedPairs.slice(i, i + RESOLVE_BATCH_SIZE);
          const response = await dataSource.resolveModelCards(batch);
          for (const item of response.resolved ?? []) {
            if (item.status === 'resolved' && item.card) {
              nextPricingMap.set(pricingKey(item.provider, item.model), item.card.pricing);
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
      } catch (err) {
        if (cancelled) {
          return;
        }
        setPricingMap(new Map());
        setUnresolved([]);
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

  return { pricingMap, unresolved, loading, error };
}
