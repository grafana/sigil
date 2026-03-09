import type { ConversationsDataSource } from './api';
import { parseOTLPTrace, buildSpanTree } from './spans';
import type { ConversationData, ConversationDetail } from './types';

export type TraceFetcher = (traceID: string) => Promise<unknown>;

const TRACE_FETCH_CONCURRENCY = 5;
const DETAIL_RETRY_DELAYS_MS = [250, 750, 1500];
const TRACE_EMPTY_RETRY_DELAYS_MS = [750];

type TraceResult = { traceID: string; payload: unknown };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const maybeStatus = (error as { status?: unknown }).status;
  return typeof maybeStatus === 'number' ? maybeStatus : undefined;
}

function shouldRetryConversationDetail(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === undefined) {
    return true;
  }
  if (status === 408 || status === 429) {
    return true;
  }
  return status >= 500;
}

function parseTraceResults(results: TraceResult[]): ReturnType<typeof parseOTLPTrace> {
  return results.flatMap(({ traceID, payload }) => {
    if (payload === null) {
      return [];
    }
    return parseOTLPTrace(traceID, payload);
  });
}

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

  const promise = (async () => {
    let attempt = 0;
    // Projection-backed search can surface a conversation slightly before the
    // remote detail path settles, so tolerate brief 5xx/read flaps here.
    for (;;) {
      try {
        const detail = await dataSource.getConversationDetail(conversationID);
        return detailToConversationData(detail);
      } catch (error) {
        if (attempt >= DETAIL_RETRY_DELAYS_MS.length || !shouldRetryConversationDetail(error)) {
          throw error;
        }
        const delay = DETAIL_RETRY_DELAYS_MS[attempt];
        attempt += 1;
        await sleep(delay);
      }
    }
  })().finally(() => inflightDetails.delete(conversationID));

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

  let tracePayloads = await fetchTracesWithConcurrency(traceIDs, fetchTrace);
  let allParsedSpans = parseTraceResults(tracePayloads);
  if (allParsedSpans.length === 0) {
    // Recent conversations can arrive in projection before Tempo serves the
    // corresponding traces. Retry once before rendering an empty tree.
    for (const delay of TRACE_EMPTY_RETRY_DELAYS_MS) {
      await sleep(delay);
      tracePayloads = await fetchTracesWithConcurrency(traceIDs, fetchTrace);
      allParsedSpans = parseTraceResults(tracePayloads);
      if (allParsedSpans.length > 0) {
        break;
      }
    }
  }

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
