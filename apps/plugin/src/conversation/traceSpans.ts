import { normalizeSpanID, normalizeTraceID } from './ids';

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const NS_PER_MS = BigInt(1_000_000);
const SIGIL_ATTR_PREFIX = 'sigil.';
const SIGIL_GENERATION_ID_KEY = 'sigil.generation.id';
const GEN_AI_OPERATION_NAME_KEY = 'gen_ai.operation.name';

const GENERATION_OPERATION_NAMES = new Set(['generatetext', 'streamtext', 'text_completion']);
const TOOL_OPERATION_NAMES = new Set(['execute_tool']);
const MODEL_OPERATION_NAMES = new Set(['embeddings']);

type AttrValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
};

type AttrKV = {
  key?: string;
  value?: AttrValue;
};

type TempoSpan = {
  spanId?: string;
  spanID?: string;
  span_id?: string;
  parentSpanId?: string;
  parentSpanID?: string;
  parent_span_id?: string;
  name?: string;
  completed_at?: string | number;
  completedAt?: string | number;
  startTimeUnixNano?: string | number;
  start_time_unix_nano?: string | number;
  endTimeUnixNano?: string | number;
  end_time_unix_nano?: string | number;
  attributes?: AttrKV[];
};

type TempoScopeSpan = {
  spans?: TempoSpan[];
};

type TempoResource = {
  attributes?: AttrKV[];
};

type TempoResourceSpan = {
  resource?: TempoResource;
  scopeSpans?: TempoScopeSpan[];
  scope_spans?: TempoScopeSpan[];
  instrumentationLibrarySpans?: TempoScopeSpan[];
};

type TempoTrace = {
  resourceSpans?: TempoResourceSpan[];
  resource_spans?: TempoResourceSpan[];
  batches?: TempoResourceSpan[];
};

export type ParsedTraceSpan = {
  traceID: string;
  spanID: string;
  parentSpanID: string;
  name: string;
  serviceName: string;
  startNs: bigint;
  endNs: bigint;
  durationNs: bigint;
  selectionID: string;
  attributes: Record<string, string>;
};

export type SigilSpanKind = 'generation' | 'tool' | 'model' | 'evaluation' | 'other';

export type SigilSpan = ParsedTraceSpan & {
  sigilKind: SigilSpanKind;
};

export type SpanSelectionMode = 'sigil-only' | 'all';

export type GenerationLike = {
  generation_id: string;
  trace_id?: string;
  span_id?: string;
};

export type LaidOutTraceSpan = ParsedTraceSpan & {
  row: number;
};

function parseNs(raw: unknown): bigint | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return null;
    }
    return BigInt(Math.trunc(raw));
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  try {
    const parsed = BigInt(raw);
    return parsed > BIGINT_ZERO ? parsed : null;
  } catch {
    return null;
  }
}

function parseTimestampToNs(raw: unknown): bigint | null {
  if (typeof raw === 'number') {
    return parseNs(raw);
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const numeric = /^\d+$/.test(raw) ? parseNs(raw) : null;
  if (numeric != null) {
    return numeric;
  }
  const parsedMs = Date.parse(raw);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }
  return BigInt(Math.trunc(parsedMs)) * NS_PER_MS;
}

function findServiceName(resourceSpan: TempoResourceSpan): string {
  const attributes = resourceSpan.resource?.attributes;
  if (!Array.isArray(attributes)) {
    return 'unknown-service';
  }
  const serviceAttr = attributes.find((attr) => attr?.key === 'service.name');
  return readAttributeValue(serviceAttr?.value) ?? 'unknown-service';
}

function readAttributeValue(value: AttrValue | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value.stringValue === 'string') {
    return value.stringValue;
  }
  if (typeof value.boolValue === 'boolean') {
    return String(value.boolValue);
  }
  if (typeof value.intValue === 'number') {
    return String(value.intValue);
  }
  if (typeof value.intValue === 'string') {
    return value.intValue;
  }
  if (typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue)) {
    return String(value.doubleValue);
  }
  return null;
}

function toAttributeMap(attributes: AttrKV[] | undefined): Record<string, string> {
  if (!Array.isArray(attributes)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const attribute of attributes) {
    if (typeof attribute?.key !== 'string' || attribute.key.length === 0) {
      continue;
    }
    const value = readAttributeValue(attribute.value);
    if (value == null) {
      continue;
    }
    map[attribute.key] = value;
  }
  return map;
}

function getTraceCandidates(payload: unknown): TempoTrace[] {
  if (payload == null || typeof payload !== 'object') {
    return [];
  }
  const maybeTrace = payload as { trace?: unknown; traces?: unknown[] };
  const candidates: unknown[] = [payload];
  if (maybeTrace.trace != null) {
    candidates.push(maybeTrace.trace);
  }
  if (Array.isArray(maybeTrace.traces)) {
    candidates.push(...maybeTrace.traces);
  }
  return candidates.filter((candidate): candidate is TempoTrace => candidate != null && typeof candidate === 'object');
}

export function buildTraceSpans(traceID: string, payload: unknown): ParsedTraceSpan[] {
  const spans: ParsedTraceSpan[] = [];
  const traceCandidates = getTraceCandidates(payload);
  const normalizedTraceID = normalizeTraceID(traceID) || traceID;

  for (const trace of traceCandidates) {
    const resourceSpans = trace.resourceSpans ?? trace.resource_spans ?? trace.batches;
    if (!Array.isArray(resourceSpans)) {
      continue;
    }

    for (const resourceSpan of resourceSpans) {
      const serviceName = findServiceName(resourceSpan);
      const scopeSpans =
        resourceSpan.scopeSpans ?? resourceSpan.scope_spans ?? resourceSpan.instrumentationLibrarySpans;
      if (!Array.isArray(scopeSpans)) {
        continue;
      }

      for (const scopeSpan of scopeSpans) {
        if (!Array.isArray(scopeSpan.spans)) {
          continue;
        }
        for (const span of scopeSpan.spans) {
          const startNs = parseNs(span.startTimeUnixNano ?? span.start_time_unix_nano);
          const completedAtNs = parseTimestampToNs(span.completed_at ?? span.completedAt);
          const endNs = completedAtNs ?? parseNs(span.endTimeUnixNano ?? span.end_time_unix_nano);
          if (startNs == null) {
            continue;
          }
          const safeEnd = endNs != null && endNs >= startNs ? endNs : startNs;
          const spanID = normalizeSpanID(span.spanId ?? span.spanID ?? span.span_id ?? '');
          const parentSpanID = normalizeSpanID(span.parentSpanId ?? span.parentSpanID ?? span.parent_span_id ?? '');
          const name = span.name?.trim() ?? '';
          spans.push({
            traceID: normalizedTraceID,
            spanID,
            parentSpanID,
            name: name.length > 0 ? name : '(unnamed span)',
            serviceName,
            startNs,
            endNs: safeEnd,
            durationNs: safeEnd > startNs ? safeEnd - startNs : BIGINT_ONE,
            selectionID: `${normalizedTraceID}:${spanID.length > 0 ? spanID : `${startNs}`}`,
            attributes: toAttributeMap(span.attributes),
          });
        }
      }
    }
  }

  return spans;
}

export function layoutTraceSpans(rawSpans: ParsedTraceSpan[]): { rowCount: number; spans: LaidOutTraceSpan[] } {
  const sorted = [...rawSpans].sort((a, b) => {
    if (a.startNs !== b.startNs) {
      return a.startNs < b.startNs ? -1 : 1;
    }
    if (b.durationNs === a.durationNs) {
      return 0;
    }
    return b.durationNs > a.durationNs ? 1 : -1;
  });

  const rowEndNs: bigint[] = [];
  const laidOut = sorted.map((span) => {
    let row = 0;
    while (row < rowEndNs.length && span.startNs < rowEndNs[row]) {
      row += 1;
    }
    if (rowEndNs[row] == null || span.endNs > rowEndNs[row]) {
      rowEndNs[row] = span.endNs;
    }
    return {
      ...span,
      row,
    };
  });

  return {
    rowCount: Math.max(rowEndNs.length, 1),
    spans: laidOut,
  };
}

function getOperationName(span: ParsedTraceSpan): string {
  return span.attributes[GEN_AI_OPERATION_NAME_KEY]?.trim().toLowerCase() ?? '';
}

function getSigilAttributeKeys(span: ParsedTraceSpan): string[] {
  return Object.keys(span.attributes).filter((key) => key.startsWith(SIGIL_ATTR_PREFIX));
}

export function isSigilSpan(span: ParsedTraceSpan): boolean {
  const hasSigilName = span.name.toLowerCase().includes('sigil');
  if (span.attributes[SIGIL_GENERATION_ID_KEY]?.trim().length) {
    return true;
  }
  if (getSigilAttributeKeys(span).length > 0) {
    return true;
  }
  return hasSigilName;
}

export function classifySigilSpanKind(span: ParsedTraceSpan): SigilSpanKind {
  const spanName = span.name.toLowerCase();
  const operationName = getOperationName(span);
  const sigilKeys = getSigilAttributeKeys(span);
  const joined = [spanName, operationName, ...sigilKeys].join(' ');

  if (TOOL_OPERATION_NAMES.has(operationName) || joined.includes('tool')) {
    return 'tool';
  }
  if (joined.includes('eval') || joined.includes('score') || joined.includes('judge')) {
    return 'evaluation';
  }
  if (
    GENERATION_OPERATION_NAMES.has(operationName) ||
    joined.includes('generation') ||
    joined.includes('prompt') ||
    joined.includes('response')
  ) {
    return 'generation';
  }
  if (
    MODEL_OPERATION_NAMES.has(operationName) ||
    joined.includes('model') ||
    joined.includes('llm') ||
    joined.includes('embedding')
  ) {
    return 'model';
  }
  return 'other';
}

function generationIDFromSpan(span: ParsedTraceSpan): string {
  return span.attributes[SIGIL_GENERATION_ID_KEY]?.trim() ?? '';
}

function isSpanAssociatedWithGeneration(generation: GenerationLike, span: SigilSpan): boolean {
  const spanGenerationID = generationIDFromSpan(span);
  if (spanGenerationID.length > 0) {
    return generation.generation_id.length > 0 && spanGenerationID === generation.generation_id;
  }
  const normalizedTraceID = normalizeTraceID(generation.trace_id);
  if (normalizedTraceID.length > 0 && normalizedTraceID === span.traceID) {
    const normalizedSpanID = normalizeSpanID(generation.span_id);
    if (normalizedSpanID.length === 0) {
      return true;
    }
    return normalizedSpanID === span.spanID;
  }
  return false;
}

export function groupSigilSpansByGenerationID(
  generations: GenerationLike[],
  spans: ParsedTraceSpan[]
): Record<string, SigilSpan[]> {
  const grouped: Record<string, SigilSpan[]> = {};
  const sigilSpans = extractSigilSpans(spans);
  for (const generation of generations) {
    grouped[generation.generation_id] = sigilSpans.filter((span) => isSpanAssociatedWithGeneration(generation, span));
  }
  return grouped;
}

export function selectSpansForMode(spans: ParsedTraceSpan[], mode: SpanSelectionMode): SigilSpan[] {
  const allWithKinds = spans.map((span) => ({
    ...span,
    sigilKind: classifySigilSpanKind(span),
  }));

  if (mode === 'all') {
    return allWithKinds;
  }

  const byTraceAndSpanID = new Map<string, SigilSpan>();
  for (const span of allWithKinds) {
    if (span.spanID.length > 0) {
      byTraceAndSpanID.set(`${span.traceID}:${span.spanID}`, span);
    }
  }
  const isRootSpan = (span: SigilSpan): boolean => {
    if (span.parentSpanID.length === 0) {
      return true;
    }
    return !byTraceAndSpanID.has(`${span.traceID}:${span.parentSpanID}`);
  };

  const selectedWithRoots = allWithKinds.filter((span) => span.sigilKind !== 'other' || isRootSpan(span));
  const selectedWithRootsBySelectionID = new Set(selectedWithRoots.map((span) => span.selectionID));

  const nearestSelectedParentSpanID = (span: SigilSpan): string => {
    let parentSpanID = span.parentSpanID;
    while (parentSpanID.length > 0) {
      const parent = byTraceAndSpanID.get(`${span.traceID}:${parentSpanID}`);
      if (parent == null) {
        return '';
      }
      if (selectedWithRootsBySelectionID.has(parent.selectionID)) {
        return parent.spanID;
      }
      parentSpanID = parent.parentSpanID;
    }
    return '';
  };

  return selectedWithRoots.map((span) => ({
    ...span,
    parentSpanID: nearestSelectedParentSpanID(span),
  }));
}

export function groupSpansByGenerationID(
  generations: GenerationLike[],
  spans: ParsedTraceSpan[],
  mode: SpanSelectionMode
): Record<string, SigilSpan[]> {
  const grouped: Record<string, SigilSpan[]> = {};
  const selectedSpans = selectSpansForMode(spans, mode);
  for (const generation of generations) {
    grouped[generation.generation_id] = selectedSpans.filter((span) =>
      isSpanAssociatedWithGeneration(generation, span)
    );
  }
  return grouped;
}

export function extractSigilSpans(spans: ParsedTraceSpan[]): SigilSpan[] {
  const sigilSpans: SigilSpan[] = [];
  for (const span of spans) {
    if (!isSigilSpan(span)) {
      continue;
    }
    sigilSpans.push({
      ...span,
      sigilKind: classifySigilSpanKind(span),
    });
  }
  return sigilSpans;
}
