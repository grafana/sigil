import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import {
  loadConversationDetail,
  loadConversationTraces,
  mergeConversationData,
  type TraceFetcher,
} from '../conversation/loader';
import {
  getAllGenerations,
  getCostSummary,
  getTokenSummary,
  type CostSummary,
  type TokenSummary,
} from '../conversation/aggregates';
import { resolveGenerationCosts } from '../generation/cost';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import { inferProviderFromModelName, resolveModelCardsFromNames, type ModelInput } from '../modelcard/resolve';
import type { ModelCard } from '../modelcard/types';
import type { ConversationData } from '../conversation/types';
import type { GenerationCostResult, GenerationDetail } from '../generation/types';

const defaultTraceFetcher = createTempoTraceFetcher();
const INITIAL_GENERATION_PAGE_SIZE = 20;

export type UseConversationDataOptions = {
  conversationID: string;
  dataSource?: ConversationsDataSource;
  traceFetcher?: TraceFetcher;
  modelCardClient?: ModelCardClient;
};

export type UseConversationDataResult = {
  conversationData: ConversationData | null;
  loading: boolean;
  tracesLoading: boolean;
  loadingMoreGenerations: boolean;
  errorMessage: string;
  loadMoreErrorMessage: string;
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  generationCosts: Map<string, GenerationCostResult>;
  modelCards: Map<string, ModelCard>;
  allGenerations: GenerationDetail[];
  loadMoreGenerations: () => Promise<void>;
};

export function useConversationData({
  conversationID,
  dataSource = defaultConversationsDataSource,
  traceFetcher = defaultTraceFetcher,
  modelCardClient = defaultModelCardClient,
}: UseConversationDataOptions): UseConversationDataResult {
  const [conversationData, setConversationData] = useState<ConversationData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [tracesLoading, setTracesLoading] = useState<boolean>(false);
  const [loadingMoreGenerations, setLoadingMoreGenerations] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [loadMoreErrorMessage, setLoadMoreErrorMessage] = useState<string>('');
  const [conversationCosts, setConversationCosts] = useState<Map<string, GenerationCostResult>>(new Map());
  const [nameResolvedModelCards, setNameResolvedModelCards] = useState<Map<string, ModelCard>>(new Map());
  const requestVersionRef = useRef<number>(0);
  const conversationDataRef = useRef<ConversationData | null>(null);

  const applyConversationData = useCallback((nextData: ConversationData | null) => {
    conversationDataRef.current = nextData;
    setConversationData(nextData);
  }, []);

  const mergeTraceResultIntoCurrent = useCallback(
    (traceData: ConversationData) => {
      const latest = conversationDataRef.current;
      if (!latest) {
        applyConversationData(traceData);
        return;
      }
      applyConversationData(mergeConversationData(traceData, latest));
    },
    [applyConversationData]
  );

  useEffect(() => {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;

    if (conversationID.length === 0) {
      queueMicrotask(() => {
        applyConversationData(null);
        setLoading(false);
        setTracesLoading(false);
        setLoadingMoreGenerations(false);
        setErrorMessage('');
        setLoadMoreErrorMessage('');
      });
      return;
    }

    queueMicrotask(() => {
      setLoading(true);
      setTracesLoading(false);
      setLoadingMoreGenerations(false);
      setErrorMessage('');
      setLoadMoreErrorMessage('');
      applyConversationData(null);
    });

    void loadConversationDetail(dataSource, conversationID, { limit: INITIAL_GENERATION_PAGE_SIZE })
      .then((data) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        applyConversationData(data);
        setLoading(false);
        setTracesLoading(true);

        return loadConversationTraces(data, traceFetcher, {
          onProgress: (partialData) => {
            if (requestVersionRef.current !== requestVersion) {
              return;
            }
            mergeTraceResultIntoCurrent(partialData);
          },
        }).then((enriched) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          mergeTraceResultIntoCurrent(enriched);
          setTracesLoading(false);
        });
      })
      .catch((error) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversation detail');
        setLoading(false);
        setTracesLoading(false);
      });
  }, [applyConversationData, dataSource, conversationID, mergeTraceResultIntoCurrent, traceFetcher]);

  const loadMoreGenerations = async () => {
    const current = conversationDataRef.current;
    if (!current?.hasMoreGenerations || !current.nextGenerationsCursor || loadingMoreGenerations) {
      return;
    }

    const requestVersion = requestVersionRef.current;
    setLoadingMoreGenerations(true);
    setLoadMoreErrorMessage('');

    try {
      const pageData = await loadConversationDetail(dataSource, conversationID, {
        limit: INITIAL_GENERATION_PAGE_SIZE,
        cursor: current.nextGenerationsCursor,
      });
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      if (pageData.orphanGenerations.length === 0 || pageData.nextGenerationsCursor === current.nextGenerationsCursor) {
        const freshCurrent = conversationDataRef.current ?? current;
        const stabilized = {
          ...freshCurrent,
          hasMoreGenerations: false,
          nextGenerationsCursor: undefined,
        };
        applyConversationData(stabilized);
        return;
      }

      const mergePartial = (partialPage: ConversationData) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const latest = conversationDataRef.current;
        if (!latest) {
          return;
        }
        const merged = mergeConversationData(latest, partialPage);
        applyConversationData(merged);
      };

      mergePartial(pageData);
      const enrichedPage = await loadConversationTraces(pageData, traceFetcher, {
        onProgress: mergePartial,
      });
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      const latest = conversationDataRef.current;
      if (!latest) {
        return;
      }
      const merged = mergeConversationData(latest, enrichedPage);
      applyConversationData(merged);
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setLoadMoreErrorMessage(error instanceof Error ? error.message : 'failed to load more generations');
    } finally {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setLoadingMoreGenerations(false);
    }
  };

  const allGenerations = useMemo<GenerationDetail[]>(() => {
    if (!conversationData) {
      return [];
    }
    return getAllGenerations(conversationData);
  }, [conversationData]);

  useEffect(() => {
    if (!conversationData) {
      queueMicrotask(() => setConversationCosts(new Map()));
      return;
    }
    if (allGenerations.length === 0) {
      return;
    }
    void resolveGenerationCosts(allGenerations, modelCardClient)
      .then(setConversationCosts)
      .catch(() => {
        setConversationCosts(new Map());
      });
  }, [conversationData, allGenerations, modelCardClient]);

  const costModelCards = useMemo(() => {
    const cards = new Map<string, ModelCard>();
    for (const [, cost] of conversationCosts) {
      const key = `${cost.provider}::${cost.model}`;
      if (!cards.has(key)) {
        cards.set(key, cost.card);
      }
    }
    return cards;
  }, [conversationCosts]);

  const modelsForFallback = useMemo<ModelInput[]>(() => {
    if (costModelCards.size > 0) {
      return [];
    }
    const seen = new Set<string>();
    const inputs: ModelInput[] = [];

    for (const generation of allGenerations) {
      const name = generation.model?.name?.trim() ?? '';
      if (name.length === 0) {
        continue;
      }

      const provider = generation.model?.provider?.trim() ?? '';
      const keyProvider = provider || inferProviderFromModelName(name);
      const key = `${keyProvider}::${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      if (provider.length > 0) {
        inputs.push({ name, provider });
      } else {
        inputs.push(name);
      }
    }

    return inputs;
  }, [costModelCards, allGenerations]);

  useEffect(() => {
    if (modelsForFallback.length === 0) {
      queueMicrotask(() => setNameResolvedModelCards(new Map()));
      return;
    }
    void resolveModelCardsFromNames(modelsForFallback, modelCardClient)
      .then(setNameResolvedModelCards)
      .catch(() => {
        setNameResolvedModelCards(new Map());
      });
  }, [modelsForFallback, modelCardClient]);

  const modelCards = costModelCards.size > 0 ? costModelCards : nameResolvedModelCards;

  const tokenSummary = useMemo<TokenSummary | null>(() => {
    if (!conversationData) {
      return null;
    }
    return getTokenSummary(conversationData);
  }, [conversationData]);

  const costSummary = useMemo<CostSummary | null>(() => {
    if (conversationCosts.size === 0) {
      return null;
    }
    return getCostSummary(conversationCosts);
  }, [conversationCosts]);

  return {
    conversationData,
    loading,
    tracesLoading,
    loadingMoreGenerations,
    errorMessage,
    loadMoreErrorMessage,
    tokenSummary,
    costSummary,
    generationCosts: conversationCosts,
    modelCards,
    allGenerations,
    loadMoreGenerations,
  };
}
