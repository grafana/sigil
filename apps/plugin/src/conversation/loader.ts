import type { ConversationsDataSource } from './api';
import { parseOTLPTrace, buildSpanTree } from './spans';
import type { ConversationData, ConversationDetail } from './types';

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

function detailToConversationData(detail: ConversationDetail): ConversationData {
  return {
    conversationID: detail.conversation_id,
    conversationTitle: detail.conversation_title,
    userID: detail.user_id,
    generationCount: detail.generation_count,
    firstGenerationAt: detail.first_generation_at,
    lastGenerationAt: detail.last_generation_at,
    ratingSummary: detail.rating_summary ?? null,
    annotations: detail.annotations ?? [],
    spans: [],
    orphanGenerations: detail.generations,
  };
}

const inflightDetails = new Map<string, Promise<ConversationData>>();

export function loadConversationDetail(
  dataSource: ConversationsDataSource,
  conversationID: string
): Promise<ConversationData> {
  const existing = inflightDetails.get(conversationID);
  if (existing) {
    return existing;
  }

  const promise = dataSource
    .getConversationDetail(conversationID)
    .then(detailToConversationData)
    .finally(() => inflightDetails.delete(conversationID));

  inflightDetails.set(conversationID, promise);
  return promise;
}

export async function loadConversationTraces(
  data: ConversationData,
  fetchTrace: TraceFetcher
): Promise<ConversationData> {
  const traceIDSet = new Set<string>();
  for (const gen of data.orphanGenerations) {
    if (gen.trace_id && gen.trace_id.length > 0) {
      traceIDSet.add(gen.trace_id);
    }
  }

  const traceIDs = Array.from(traceIDSet);
  if (traceIDs.length === 0) {
    return data;
  }

  const tracePayloads = await fetchTracesWithConcurrency(traceIDs, fetchTrace);

  const allParsedSpans = tracePayloads.flatMap(({ traceID, payload }) => {
    if (payload === null) {
      return [];
    }
    return parseOTLPTrace(traceID, payload);
  });

  const allGenerations = data.orphanGenerations;
  const { roots, orphanGenerations } = buildSpanTree(allParsedSpans, allGenerations);

  return {
    ...data,
    spans: roots,
    orphanGenerations,
  };
}

export async function loadConversation(
  dataSource: ConversationsDataSource,
  conversationID: string,
  fetchTrace: TraceFetcher
): Promise<ConversationData> {
  const data = await loadConversationDetail(dataSource, conversationID);
  return loadConversationTraces(data, fetchTrace);
}
