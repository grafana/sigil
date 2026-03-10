import { useEffect, useMemo, useRef, useState } from 'react';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { loadConversationDetail, loadConversationTraces, type TraceFetcher } from '../conversation/loader';
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
  errorMessage: string;
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  generationCosts: Map<string, GenerationCostResult>;
  modelCards: Map<string, ModelCard>;
  allGenerations: GenerationDetail[];
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
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [conversationCosts, setConversationCosts] = useState<Map<string, GenerationCostResult>>(new Map());
  const [nameResolvedModelCards, setNameResolvedModelCards] = useState<Map<string, ModelCard>>(new Map());
  const requestVersionRef = useRef<number>(0);

  useEffect(() => {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;

    if (conversationID.length === 0) {
      queueMicrotask(() => {
        setConversationData(null);
        setLoading(false);
        setTracesLoading(false);
        setErrorMessage('');
      });
      return;
    }

    queueMicrotask(() => {
      setLoading(true);
      setTracesLoading(false);
      setErrorMessage('');
      setConversationData(null);
    });

    void loadConversationDetail(dataSource, conversationID)
      .then((data) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setConversationData(data);
        setLoading(false);
        setTracesLoading(true);

        return loadConversationTraces(data, traceFetcher, {
          onProgress: (partialData) => {
            if (requestVersionRef.current !== requestVersion) {
              return;
            }
            setConversationData(partialData);
          },
        }).then((enriched) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          setConversationData(enriched);
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
  }, [dataSource, conversationID, traceFetcher]);

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
    errorMessage,
    tokenSummary,
    costSummary,
    generationCosts: conversationCosts,
    modelCards,
    allGenerations,
  };
}
