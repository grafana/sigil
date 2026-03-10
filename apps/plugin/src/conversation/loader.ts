import { dateTime, type TimeRange } from '@grafana/data';
import type { ConversationsDataSource } from './api';
import { normalizeTraceID } from './ids';
import { parseOTLPTrace, buildSpanTree } from './spans';
import type { GenerationDetail } from '../generation/types';
import type { ConversationData, ConversationDetail } from './types';

const TRACE_FETCH_TIME_PADDING_MS = 30 * 60 * 1000;

export type TraceFetchOptions = {
  timeRange?: Pick<TimeRange, 'from' | 'to'>;
};

export type TraceFetcher = (traceID: string, options?: TraceFetchOptions) => Promise<unknown>;

const TRACE_FETCH_CONCURRENCY = 10;
const DETAIL_RETRY_DELAYS_MS = [250, 750, 1500];
const TRACE_EMPTY_RETRY_DELAYS_MS = [750];

type TraceResult = { traceID: string; payload: unknown };
type TraceResultListener = (result: TraceResult) => void;

export type LoadConversationTracesOptions = {
  onProgress?: (data: ConversationData) => void;
};

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
  options?: TraceFetchOptions,
  onResult?: TraceResultListener,
  concurrency: number = TRACE_FETCH_CONCURRENCY
): Promise<TraceResult[]> {
  const results: TraceResult[] = new Array(traceIDs.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < traceIDs.length) {
      const i = nextIndex++;
      try {
        const payload = await fetchTrace(traceIDs[i], options);
        const result = { traceID: traceIDs[i], payload };
        results[i] = result;
        onResult?.(result);
      } catch {
        const result = { traceID: traceIDs[i], payload: null };
        results[i] = result;
        onResult?.(result);
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

function buildConversationTraceFetchOptions(data: ConversationData): TraceFetchOptions | undefined {
  const startMs = Date.parse(data.firstGenerationAt);
  const endMs = Date.parse(data.lastGenerationAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return undefined;
  }

  const boundedStartMs = Math.min(startMs, endMs) - TRACE_FETCH_TIME_PADDING_MS;
  const boundedEndMs = Math.max(startMs, endMs) + TRACE_FETCH_TIME_PADDING_MS;
  return {
    timeRange: {
      from: dateTime(boundedStartMs),
      to: dateTime(boundedEndMs),
    },
  };
}

function generationTimestampMs(generation: GenerationDetail): number | undefined {
  if (!generation.created_at) {
    return undefined;
  }
  const parsed = Date.parse(generation.created_at);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function orderTraceIDsByNewestGeneration(generations: GenerationDetail[]): string[] {
  const firstSeenIndex = new Map<string, number>();
  const newestTimestampByTraceID = new Map<string, number>();

  for (const [index, generation] of generations.entries()) {
    const normalizedTraceID = normalizeTraceID(generation.trace_id);
    if (normalizedTraceID.length === 0) {
      continue;
    }
    if (!firstSeenIndex.has(normalizedTraceID)) {
      firstSeenIndex.set(normalizedTraceID, index);
    }
    const timestampMs = generationTimestampMs(generation);
    if (timestampMs === undefined) {
      continue;
    }
    const existing = newestTimestampByTraceID.get(normalizedTraceID);
    if (existing === undefined || timestampMs > existing) {
      newestTimestampByTraceID.set(normalizedTraceID, timestampMs);
    }
  }

  return Array.from(firstSeenIndex.keys()).sort((left, right) => {
    const leftTimestamp = newestTimestampByTraceID.get(left);
    const rightTimestamp = newestTimestampByTraceID.get(right);
    if (leftTimestamp !== undefined && rightTimestamp !== undefined && leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
    if (leftTimestamp === undefined && rightTimestamp !== undefined) {
      return 1;
    }
    if (leftTimestamp !== undefined && rightTimestamp === undefined) {
      return -1;
    }
    return (firstSeenIndex.get(left) ?? 0) - (firstSeenIndex.get(right) ?? 0);
  });
}

export async function loadConversationTraces(
  data: ConversationData,
  fetchTrace: TraceFetcher,
  loadOptions?: LoadConversationTracesOptions
): Promise<ConversationData> {
  const traceIDs = orderTraceIDsByNewestGeneration(data.orphanGenerations);
  if (traceIDs.length === 0) {
    return data;
  }

  const allGenerations = data.orphanGenerations;
  const fetchOptions = buildConversationTraceFetchOptions(data);
  const parsedSpans = parseTraceResults([]);

  const emitProgress = () => {
    const { roots, orphanGenerations } = buildSpanTree(parsedSpans, allGenerations);
    loadOptions?.onProgress?.({
      ...data,
      spans: roots,
      orphanGenerations,
    });
  };

  const handleTraceResult = ({ traceID, payload }: TraceResult) => {
    if (payload === null) {
      return;
    }
    parsedSpans.push(...parseOTLPTrace(traceID, payload));
    if (loadOptions?.onProgress) {
      emitProgress();
    }
  };

  let tracePayloads = await fetchTracesWithConcurrency(traceIDs, fetchTrace, fetchOptions, handleTraceResult);
  let allParsedSpans = parsedSpans.length > 0 ? [...parsedSpans] : parseTraceResults(tracePayloads);
  if (allParsedSpans.length === 0) {
    // Recent conversations can arrive in projection before Tempo serves the
    // corresponding traces. Retry once before rendering an empty tree.
    for (const delay of TRACE_EMPTY_RETRY_DELAYS_MS) {
      await sleep(delay);
      tracePayloads = await fetchTracesWithConcurrency(traceIDs, fetchTrace, fetchOptions, handleTraceResult);
      allParsedSpans = parseTraceResults(tracePayloads);
      if (allParsedSpans.length > 0) {
        break;
      }
    }
  }

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
