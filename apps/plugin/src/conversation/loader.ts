import type { ConversationsDataSource } from './api';
import { parseOTLPTrace, buildSpanTree } from './spans';
import type { ConversationData } from './types';

export type TraceFetcher = (traceID: string) => Promise<unknown>;

const TRACE_FETCH_CONCURRENCY = 5;

type TraceResult = { traceID: string; payload: unknown };

async function fetchTracesWithConcurrency(
  traceIDs: string[],
  fetchTrace: TraceFetcher,
  concurrency: number = TRACE_FETCH_CONCURRENCY
): Promise<TraceResult[]> {
  const results: TraceResult[] = new Array(traceIDs.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < traceIDs.length) {
      const i = nextIndex++;
      try {
        const payload = await fetchTrace(traceIDs[i]);
        results[i] = { traceID: traceIDs[i], payload };
      } catch {
        results[i] = { traceID: traceIDs[i], payload: null };
      }
    }
  }

  const workerCount = Math.min(concurrency, traceIDs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

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
  const tracePayloads = await fetchTracesWithConcurrency(traceIDs, fetchTrace);

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
