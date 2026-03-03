import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationDetail } from '../../conversation/types';
import { defaultDashboardDataSource, type DashboardDataSource } from '../../dashboard/api';
import { pricingKey, type PricingMap } from '../../dashboard/cost';
import { type ModelCardResolveItem } from '../../dashboard/types';
import { buildGenerationModelResolvePairs } from './generationMetrics';

const RESOLVE_BATCH_SIZE = 50;

export type ConversationResolvedPricingResult = {
  pricingMap: PricingMap;
  unresolved: ModelCardResolveItem[];
  loading: boolean;
  error: string;
};

export function useConversationResolvedPricing(
  generations: GenerationDetail[],
  dataSource: DashboardDataSource = defaultDashboardDataSource
): ConversationResolvedPricingResult {
  const conversationKey = generations[0]?.conversation_id ?? '';
  const pairs = useMemo(() => buildGenerationModelResolvePairs(generations), [generations]);
  const resolvedRef = useRef<PricingMap>(new Map());
  const unresolvedRef = useRef<Map<string, ModelCardResolveItem>>(new Map());
  const [pricingMap, setPricingMap] = useState<PricingMap>(new Map());
  const [unresolved, setUnresolved] = useState<ModelCardResolveItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    resolvedRef.current = new Map();
    unresolvedRef.current = new Map();
    setPricingMap(new Map());
    setUnresolved([]);
    setLoading(false);
    setError('');
  }, [conversationKey]);

  useEffect(() => {
    if (pairs.length === 0) {
      setPricingMap(new Map());
      setUnresolved([]);
      setLoading(false);
      setError('');
      return;
    }

    const missingPairs = pairs.filter((pair) => {
      const key = pricingKey(pair.provider, pair.model);
      return !resolvedRef.current.has(key) && !unresolvedRef.current.has(key);
    });

    if (missingPairs.length === 0) {
      setPricingMap(new Map(resolvedRef.current));
      setUnresolved(Array.from(unresolvedRef.current.values()));
      setLoading(false);
      setError('');
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        for (let i = 0; i < missingPairs.length; i += RESOLVE_BATCH_SIZE) {
          const batch = missingPairs.slice(i, i + RESOLVE_BATCH_SIZE);
          const response = await dataSource.resolveModelCards(batch);
          for (const item of response.resolved ?? []) {
            const key = pricingKey(item.provider, item.model);
            if (item.status === 'resolved' && item.card) {
              resolvedRef.current.set(key, item.card.pricing);
              unresolvedRef.current.delete(key);
              continue;
            }
            unresolvedRef.current.set(key, item);
          }
        }

        if (cancelled) {
          return;
        }
        setPricingMap(new Map(resolvedRef.current));
        setUnresolved(Array.from(unresolvedRef.current.values()));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to resolve model pricing');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [dataSource, pairs]);

  return { pricingMap, unresolved, loading, error };
}
