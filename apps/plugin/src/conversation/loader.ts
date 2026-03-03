import type { ConversationsDataSource } from './api';
import { parseOTLPTrace, buildSpanTree } from './spans';
import type { ConversationData } from './types';

export type TraceFetcher = (traceID: string) => Promise<unknown>;

export async function loadConversation(
  dataSource: ConversationsDataSource,
  conversationID: string,
  fetchTrace: TraceFetcher
): Promise<ConversationData> {
  const detail = await dataSource.getConversationDetail(conversationID);

  const traceIDSet = new Set<string>();
  for (const gen of detail.generations) {
    if (gen.trace_id && gen.trace_id.length > 0) {
      traceIDSet.add(gen.trace_id);
    }
  }

  const traceIDs = Array.from(traceIDSet);
  const tracePayloads = await Promise.all(
    traceIDs.map(async (traceID) => {
      try {
        const payload = await fetchTrace(traceID);
        return { traceID, payload };
      } catch {
        return { traceID, payload: null };
      }
    })
  );

  const allParsedSpans = tracePayloads.flatMap(({ traceID, payload }) => {
    if (payload === null) {
      return [];
    }
    return parseOTLPTrace(traceID, payload);
  });

  const { roots, orphanGenerations } = buildSpanTree(allParsedSpans, detail.generations);

  return {
    conversationID: detail.conversation_id,
    generationCount: detail.generation_count,
    firstGenerationAt: detail.first_generation_at,
    lastGenerationAt: detail.last_generation_at,
    ratingSummary: detail.rating_summary ?? null,
    annotations: detail.annotations ?? [],
    spans: roots,
    orphanGenerations,
  };
}
