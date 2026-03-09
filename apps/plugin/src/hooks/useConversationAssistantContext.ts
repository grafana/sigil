import { useEffect, useMemo } from 'react';
import { useProvidePageContext, useProvideQuestions } from '@grafana/assistant';
import type { TokenSummary, CostSummary } from '../conversation/aggregates';
import type { ConversationData } from '../conversation/types';
import type { GenerationCostResult, GenerationDetail } from '../generation/types';
import {
  buildConversationSummaryContext,
  buildConversationAnalysisContext,
  buildConversationSystemInstructions,
  type ConversationContextInput,
} from '../content/assistantContext';

export type UseConversationAssistantContextOptions = {
  conversationID: string;
  conversationTitle: string;
  conversationData: ConversationData | null;
  allGenerations: GenerationDetail[];
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  generationCosts: Map<string, GenerationCostResult>;
  totalDurationMs?: number;
};

const URL_PATTERN = /\/a\/grafana-sigil-app\/conversations\/.+\/(view|explore)/;

const QUESTIONS = [
  { prompt: 'Why is this conversation slow?' },
  { prompt: 'Which LLM calls are the most expensive in this conversation?' },
  { prompt: 'Are there any errors in this conversation?' },
  { prompt: 'How can I reduce the cost of this conversation?' },
  { prompt: 'Summarize what happened in this conversation' },
];

export function useConversationAssistantContext(opts: UseConversationAssistantContextOptions): void {
  const {
    conversationID,
    conversationTitle,
    conversationData,
    allGenerations,
    tokenSummary,
    costSummary,
    generationCosts,
    totalDurationMs,
  } = opts;

  const contextInput = useMemo<ConversationContextInput>(
    () => ({
      conversationID,
      conversationTitle,
      conversationData,
      allGenerations,
      tokenSummary,
      costSummary,
      generationCosts,
      totalDurationMs,
    }),
    [
      conversationID,
      conversationTitle,
      conversationData,
      allGenerations,
      tokenSummary,
      costSummary,
      generationCosts,
      totalDurationMs,
    ]
  );

  const contextItems = useMemo(() => {
    if (!conversationData) {
      return [buildConversationSystemInstructions()];
    }
    return [
      buildConversationSummaryContext(contextInput),
      buildConversationAnalysisContext(contextInput),
      buildConversationSystemInstructions(),
    ];
  }, [conversationData, contextInput]);

  const setContext = useProvidePageContext(URL_PATTERN, contextItems);

  useEffect(() => {
    setContext(contextItems);
  }, [setContext, contextItems]);

  useProvideQuestions(URL_PATTERN, QUESTIONS);
}
