import type { TimeRange } from '@grafana/data';
import type { ConversationsDataSource } from './api';
import { parseOTLPTrace, buildSpanTree } from './spans';
import type {
  ConversationData,
  ConversationDetail,
  ConversationExploreResponse,
  ConversationExploreSpan,
  ConversationSpan,
  SerializedSpanAttributes,
  SpanAttributeValue,
  SpanAttributes,
  SpanKind,
} from './types';
import type { GenerationDetail } from '../generation/types';
import { normalizeTraceID, normalizeSpanID } from './ids';

export type TraceFetchOptions = {
  timeRange?: Pick<TimeRange, 'from' | 'to'>;
};

export type TraceFetcher = (traceID: string, options?: TraceFetchOptions) => Promise<unknown>;

const TRACE_FETCH_CONCURRENCY = 5;
const DETAIL_RETRY_DELAYS_MS = [250, 750, 1500];
const TRACE_EMPTY_RETRY_DELAYS_MS = [750];
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

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
  return status >= 500 && status !== 501;
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
const inflightExplores = new Map<string, Promise<ConversationData>>();

async function loadConversationWithTransientRetry<T>(load: () => Promise<T>): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= DETAIL_RETRY_DELAYS_MS.length || !shouldRetryConversationDetail(error)) {
        throw error;
      }
      const delay = DETAIL_RETRY_DELAYS_MS[attempt];
      attempt += 1;
      await sleep(delay);
    }
  }
}

export function loadConversationDetail(
  dataSource: ConversationsDataSource,
  conversationID: string
): Promise<ConversationData> {
  const existing = inflightDetails.get(conversationID);
  if (existing) {
    return existing;
  }

  const promise = loadConversationWithTransientRetry(async () => {
    // Projection-backed search can surface a conversation slightly before the
    // remote detail path settles, so tolerate brief 5xx/read flaps here.
    const detail = await dataSource.getConversationDetail(conversationID);
    return detailToConversationData(detail);
  }).finally(() => inflightDetails.delete(conversationID));

  inflightDetails.set(conversationID, promise);
  return promise;
}

function parseSerializedNs(value: string | number | bigint | undefined): bigint | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseSerializedSpanKind(kind: SpanKind | number | string | undefined): SpanKind {
  if (kind === undefined || kind === null) {
    return 'UNSPECIFIED';
  }

  const normalized = String(kind).toUpperCase();
  switch (normalized) {
    case 'INTERNAL':
    case 'SERVER':
    case 'CLIENT':
    case 'PRODUCER':
    case 'CONSUMER':
    case 'UNSPECIFIED':
      return normalized;
    case '1':
      return 'INTERNAL';
    case '2':
      return 'SERVER';
    case '3':
      return 'CLIENT';
    case '4':
      return 'PRODUCER';
    case '5':
      return 'CONSUMER';
    default:
      return 'UNSPECIFIED';
  }
}

function toSpanAttributes(attributes: SerializedSpanAttributes | undefined): SpanAttributes {
  const result = new Map<string, SpanAttributeValue>();
  if (!attributes) {
    return result;
  }

  if (Array.isArray(attributes)) {
    for (const attribute of attributes) {
      if (attribute?.key && attribute.value) {
        result.set(attribute.key, attribute.value);
      }
    }
    return result;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value) {
      result.set(key, value);
    }
  }
  return result;
}

function sortConversationSpans(spans: ConversationSpan[]): ConversationSpan[] {
  return spans.sort((left, right) =>
    left.startTimeUnixNano < right.startTimeUnixNano ? -1 : left.startTimeUnixNano > right.startTimeUnixNano ? 1 : 0
  );
}

function buildConversationSpansFromExplore(
  serializedSpans: ConversationExploreSpan[],
  generations: GenerationDetail[]
): { roots: ConversationSpan[]; orphanGenerations: GenerationDetail[] } {
  const generationBySpan = new Map<string, GenerationDetail>();
  const matchedGenerationIDs = new Set<string>();

  for (const generation of generations) {
    const normalizedTraceID = normalizeTraceID(generation.trace_id);
    const normalizedSpanID = normalizeSpanID(generation.span_id);
    if (normalizedTraceID && normalizedSpanID) {
      generationBySpan.set(`${normalizedTraceID}:${normalizedSpanID}`, generation);
    }
  }

  function visit(span: ConversationExploreSpan): ConversationSpan {
    const traceID = span.traceID ?? span.trace_id ?? '';
    const spanID = span.spanID ?? span.span_id ?? '';
    const parentSpanID = span.parentSpanID ?? span.parent_span_id ?? '';
    const rawStartTimeUnixNano = parseSerializedNs(span.startTimeUnixNano ?? span.start_time_unix_nano);
    const rawEndTimeUnixNano = parseSerializedNs(span.endTimeUnixNano ?? span.end_time_unix_nano);
    const startTimeUnixNano = rawStartTimeUnixNano ?? rawEndTimeUnixNano ?? BIGINT_ONE;
    const endTimeUnixNano = rawEndTimeUnixNano ?? startTimeUnixNano;
    const safeEndTimeUnixNano = endTimeUnixNano >= startTimeUnixNano ? endTimeUnixNano : startTimeUnixNano;
    const durationNano =
      parseSerializedNs(span.durationNano ?? span.duration_nano) ??
      (safeEndTimeUnixNano > startTimeUnixNano ? safeEndTimeUnixNano - startTimeUnixNano : BIGINT_ONE);
    const generation = generationBySpan.get(`${normalizeTraceID(traceID)}:${normalizeSpanID(spanID)}`) ?? null;
    if (generation) {
      matchedGenerationIDs.add(generation.generation_id);
    }

    return {
      traceID,
      spanID,
      parentSpanID,
      name: span.name?.trim() || '(unnamed span)',
      kind: parseSerializedSpanKind(span.kind),
      serviceName: span.serviceName ?? span.service_name ?? '',
      startTimeUnixNano,
      endTimeUnixNano: safeEndTimeUnixNano,
      durationNano: durationNano > BIGINT_ZERO ? durationNano : BIGINT_ONE,
      attributes: toSpanAttributes(span.attributes),
      resourceAttributes: toSpanAttributes(span.resourceAttributes ?? span.resource_attributes),
      generation,
      children: sortConversationSpans((span.children ?? []).map(visit)),
    };
  }

  const roots = sortConversationSpans((serializedSpans ?? []).map(visit));
  const orphanGenerations = generations.filter((generation) => !matchedGenerationIDs.has(generation.generation_id));

  return { roots, orphanGenerations };
}

function exploreToConversationData(explore: ConversationExploreResponse): ConversationData {
  const base = detailToConversationData(explore);
  const { roots, orphanGenerations } = buildConversationSpansFromExplore(explore.spans ?? [], explore.generations);
  return {
    ...base,
    spans: roots,
    orphanGenerations,
  };
}

type ErrorWithStatus = {
  status?: number;
};

export function isConversationExploreUnavailable(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null ? (error as ErrorWithStatus).status : undefined;
  return status === 404 || status === 405 || status === 501;
}

export function loadConversationExplore(
  dataSource: ConversationsDataSource,
  conversationID: string
): Promise<ConversationData> {
  const existing = inflightExplores.get(conversationID);
  if (existing) {
    return existing;
  }

  const promise = loadConversationWithTransientRetry(async () => {
    const explore = await dataSource.getConversationExplore!(conversationID);
    return exploreToConversationData(explore);
  }).finally(() => inflightExplores.delete(conversationID));

  inflightExplores.set(conversationID, promise);
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
