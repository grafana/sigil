import { useEffect, useMemo } from 'react';
import { useProvidePageContext, useProvideQuestions } from '@grafana/assistant';
import {
  buildConversationSummaryContext,
  buildConversationAnalysisContext,
  buildConversationSystemInstructions,
  type ConversationContextInput,
} from '../content/assistantContext';

const URL_PATTERN = /\/a\/grafana-sigil-app\/conversations\/.+\/explore/;

const QUESTIONS = [
  { prompt: 'Why is this conversation slow?' },
  { prompt: 'Which LLM calls are the most expensive in this conversation?' },
  { prompt: 'Are there any errors in this conversation?' },
  { prompt: 'How can I reduce the cost of this conversation?' },
  { prompt: 'Summarize what happened in this conversation' },
];

export function useConversationAssistantContext(opts: ConversationContextInput): void {
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
