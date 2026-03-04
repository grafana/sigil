import { useEffect, useMemo, useRef, useState } from 'react';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { loadConversation, type TraceFetcher } from '../conversation/loader';
import {
  getAllGenerations,
  getCostSummary,
  getTokenSummary,
  type CostSummary,
  type TokenSummary,
} from '../conversation/aggregates';
import { resolveGenerationCosts } from '../generation/cost';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import { resolveModelCardsFromNames } from '../modelcard/resolve';
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
        setErrorMessage('');
      });
      return;
    }

    queueMicrotask(() => {
      setLoading(true);
      setErrorMessage('');
      setConversationData(null);
    });

    void loadConversation(dataSource, conversationID, traceFetcher)
      .then((data) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setConversationData(data);
      })
      .catch((error) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversation detail');
      })
      .finally(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setLoading(false);
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

  const modelNamesForFallback = useMemo(() => {
    if (costModelCards.size > 0) {
      return [];
    }
    return Array.from(new Set(allGenerations.map((g) => g.model?.name).filter((n): n is string => Boolean(n))));
  }, [costModelCards, allGenerations]);

  useEffect(() => {
    if (modelNamesForFallback.length === 0) {
      queueMicrotask(() => setNameResolvedModelCards(new Map()));
      return;
    }
    void resolveModelCardsFromNames(modelNamesForFallback, modelCardClient)
      .then(setNameResolvedModelCards)
      .catch(() => {
        setNameResolvedModelCards(new Map());
      });
  }, [modelNamesForFallback, modelCardClient]);

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
    errorMessage,
    tokenSummary,
    costSummary,
    generationCosts: conversationCosts,
    modelCards,
    allGenerations,
  };
}
