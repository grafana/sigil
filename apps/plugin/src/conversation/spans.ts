import type { GenerationDetail } from '../generation/types';
import {
  ATTR_ERROR_TYPE,
  ATTR_FRAMEWORK_NAME,
  ATTR_GENERATION_ID,
  ATTR_OPERATION_NAME,
  ATTR_SDK_NAME,
  OperationName,
  getStringAttr,
} from './attributes';
import type { ConversationSpan, SpanAttributes, SpanAttributeValue, SpanKind } from './types';

// ── Intermediate parsed span (flat, no children) ──

export type ParsedSpan = {
  traceID: string;
  spanID: string;
  parentSpanID: string;
  name: string;
  kind: SpanKind;
  serviceName: string;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
  durationNano: bigint;
  attributes: SpanAttributes;
};

// ── OTLP parsing ──

const BIGINT_ONE = BigInt(1);

type OTLPAttribute = {
  key?: string;
  value?: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: string;
    boolValue?: boolean;
    arrayValue?: { values?: SpanAttributeValue[] };
  };
};

type OTLPSpan = {
  traceId?: string;
  trace_id?: string;
  spanId?: string;
  span_id?: string;
  parentSpanId?: string;
  parent_span_id?: string;
  name?: string;
  kind?: number | string;
  startTimeUnixNano?: string | number;
  start_time_unix_nano?: string | number;
  endTimeUnixNano?: string | number;
  end_time_unix_nano?: string | number;
  attributes?: OTLPAttribute[];
};

type OTLPScopeSpan = {
  spans?: OTLPSpan[];
};

type OTLPResource = {
  attributes?: OTLPAttribute[];
};

type OTLPResourceSpan = {
  resource?: OTLPResource;
  scopeSpans?: OTLPScopeSpan[];
  scope_spans?: OTLPScopeSpan[];
  instrumentationLibrarySpans?: OTLPScopeSpan[];
};

type OTLPTrace = {
  resourceSpans?: OTLPResourceSpan[];
  resource_spans?: OTLPResourceSpan[];
  batches?: OTLPResourceSpan[];
};

function parseNs(value: string | number | undefined): bigint | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseSpanKind(kind: number | string | undefined): SpanKind {
  const kindMap: Record<string, SpanKind> = {
    '1': 'INTERNAL',
    '2': 'SERVER',
    '3': 'CLIENT',
    '4': 'PRODUCER',
    '5': 'CONSUMER',
  };
  if (kind === undefined || kind === null) {
    return 'UNSPECIFIED';
  }
  return kindMap[String(kind)] ?? 'UNSPECIFIED';
}

function buildAttributeMap(otlpAttrs: OTLPAttribute[] | undefined): SpanAttributes {
  const map = new Map<string, SpanAttributeValue>();
  if (!otlpAttrs) {
    return map;
  }
  for (const attr of otlpAttrs) {
    if (attr.key && attr.value) {
      map.set(attr.key, attr.value);
    }
  }
  return map;
}

function findServiceName(resource: OTLPResource | undefined): string {
  if (!resource?.attributes) {
    return '';
  }
  for (const attr of resource.attributes) {
    if (attr.key === 'service.name' && attr.value?.stringValue) {
      return attr.value.stringValue;
    }
  }
  return '';
}

function isOTLPTrace(obj: unknown): obj is OTLPTrace {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return Array.isArray(record.resourceSpans) || Array.isArray(record.resource_spans) || Array.isArray(record.batches);
}

function getTraceCandidates(payload: unknown): OTLPTrace[] {
  const candidates: OTLPTrace[] = [];
  if (isOTLPTrace(payload)) {
    candidates.push(payload);
  }
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (isOTLPTrace(record.trace)) {
      candidates.push(record.trace as OTLPTrace);
    }
    if (Array.isArray(record.traces)) {
      for (const t of record.traces) {
        if (isOTLPTrace(t)) {
          candidates.push(t);
        }
      }
    }
  }
  return candidates;
}

export function parseOTLPTrace(traceID: string, payload: unknown): ParsedSpan[] {
  const spans: ParsedSpan[] = [];
  const candidates = getTraceCandidates(payload);

  for (const candidate of candidates) {
    const resourceSpans = candidate.resourceSpans ?? candidate.resource_spans ?? candidate.batches ?? [];
    for (const resourceSpan of resourceSpans) {
      const serviceName = findServiceName(resourceSpan.resource);
      const scopeSpans =
        resourceSpan.scopeSpans ?? resourceSpan.scope_spans ?? resourceSpan.instrumentationLibrarySpans ?? [];
      for (const scopeSpan of scopeSpans) {
        if (!scopeSpan.spans) {
          continue;
        }
        for (const span of scopeSpan.spans) {
          const startNs = parseNs(span.startTimeUnixNano ?? span.start_time_unix_nano);
          const endNs = parseNs(span.endTimeUnixNano ?? span.end_time_unix_nano);
          if (startNs === null) {
            continue;
          }
          const safeEnd = endNs !== null && endNs >= startNs ? endNs : startNs;
          const spanID = span.spanId ?? span.span_id ?? '';
          const parentSpanID = span.parentSpanId ?? span.parent_span_id ?? '';
          const name = span.name?.trim() ?? '';

          spans.push({
            traceID,
            spanID,
            parentSpanID,
            name: name.length > 0 ? name : '(unnamed span)',
            kind: parseSpanKind(span.kind),
            serviceName,
            startTimeUnixNano: startNs,
            endTimeUnixNano: safeEnd,
            durationNano: safeEnd > startNs ? safeEnd - startNs : BIGINT_ONE,
            attributes: buildAttributeMap(span.attributes),
          });
        }
      }
    }
  }

  return spans;
}

// ── Tree building ──

export function buildSpanTree(
  parsedSpans: ParsedSpan[],
  generations: GenerationDetail[]
): { roots: ConversationSpan[]; orphanGenerations: GenerationDetail[] } {
  const genByTraceAndSpan = new Map<string, GenerationDetail>();
  const matchedGenerationIDs = new Set<string>();

  for (const gen of generations) {
    if (gen.trace_id && gen.span_id) {
      genByTraceAndSpan.set(`${gen.trace_id}:${gen.span_id}`, gen);
    }
  }

  const spanNodes = new Map<string, ConversationSpan>();
  const childrenOf = new Map<string, ConversationSpan[]>();

  for (const parsed of parsedSpans) {
    const nodeKey = `${parsed.traceID}:${parsed.spanID}`;
    const gen = genByTraceAndSpan.get(nodeKey) ?? null;
    if (gen) {
      matchedGenerationIDs.add(gen.generation_id);
    }

    const node: ConversationSpan = {
      ...parsed,
      generation: gen,
      children: [],
    };
    spanNodes.set(nodeKey, node);

    if (parsed.parentSpanID.length > 0) {
      const parentKey = `${parsed.traceID}:${parsed.parentSpanID}`;
      const siblings = childrenOf.get(parentKey) ?? [];
      siblings.push(node);
      childrenOf.set(parentKey, siblings);
    }
  }

  for (const [parentKey, children] of childrenOf) {
    const parent = spanNodes.get(parentKey);
    if (parent) {
      parent.children = children.sort((a, b) =>
        a.startTimeUnixNano < b.startTimeUnixNano ? -1 : a.startTimeUnixNano > b.startTimeUnixNano ? 1 : 0
      );
    }
  }

  const roots: ConversationSpan[] = [];
  for (const [, node] of spanNodes) {
    const parentKey = `${node.traceID}:${node.parentSpanID}`;
    if (node.parentSpanID.length === 0 || !spanNodes.has(parentKey)) {
      roots.push(node);
    }
  }

  roots.sort((a, b) =>
    a.startTimeUnixNano < b.startTimeUnixNano ? -1 : a.startTimeUnixNano > b.startTimeUnixNano ? 1 : 0
  );

  const orphanGenerations = generations.filter((gen) => !matchedGenerationIDs.has(gen.generation_id));

  return { roots, orphanGenerations };
}

// ── Span classifiers ──

export type SpanType = 'generation' | 'tool_execution' | 'embedding' | 'framework' | 'unknown';

export function getSpanType(span: ConversationSpan): SpanType {
  const opName = getStringAttr(span.attributes, ATTR_OPERATION_NAME);
  if (!opName) {
    if (getStringAttr(span.attributes, ATTR_FRAMEWORK_NAME)) {
      return 'framework';
    }
    return 'unknown';
  }
  if (opName === OperationName.GenerateText || opName === OperationName.StreamText) {
    return 'generation';
  }
  if (opName === OperationName.ExecuteTool) {
    return 'tool_execution';
  }
  if (opName === OperationName.Embeddings) {
    return 'embedding';
  }
  if (opName === OperationName.FrameworkChain || opName === OperationName.FrameworkRetriever) {
    return 'framework';
  }
  return 'unknown';
}

export function isGenerationSpan(span: ConversationSpan): boolean {
  const opName = getStringAttr(span.attributes, ATTR_OPERATION_NAME);
  return opName === OperationName.GenerateText || opName === OperationName.StreamText;
}

export function isStreamingSpan(span: ConversationSpan): boolean {
  return getStringAttr(span.attributes, ATTR_OPERATION_NAME) === OperationName.StreamText;
}

export function isToolExecutionSpan(span: ConversationSpan): boolean {
  return getStringAttr(span.attributes, ATTR_OPERATION_NAME) === OperationName.ExecuteTool;
}

export function isEmbeddingSpan(span: ConversationSpan): boolean {
  return getStringAttr(span.attributes, ATTR_OPERATION_NAME) === OperationName.Embeddings;
}

export function isFrameworkSpan(span: ConversationSpan): boolean {
  return getStringAttr(span.attributes, ATTR_FRAMEWORK_NAME) !== undefined;
}

export function isSigilSDKSpan(span: ConversationSpan): boolean {
  return getStringAttr(span.attributes, ATTR_SDK_NAME) !== undefined;
}

export function hasError(span: ConversationSpan): boolean {
  return getStringAttr(span.attributes, ATTR_ERROR_TYPE) !== undefined;
}

// ── Span helpers for UI consumption ──

export function getSelectionID(span: ConversationSpan): string {
  return `${span.traceID}:${span.spanID}`;
}

export function isSigilSpan(span: ConversationSpan): boolean {
  if (getStringAttr(span.attributes, ATTR_GENERATION_ID) !== undefined) {
    return true;
  }
  if (getStringAttr(span.attributes, ATTR_SDK_NAME) !== undefined) {
    return true;
  }
  for (const key of span.attributes.keys()) {
    if (key.startsWith('sigil.')) {
      return true;
    }
  }
  return false;
}

export function flattenSpans(roots: ConversationSpan[]): ConversationSpan[] {
  const result: ConversationSpan[] = [];
  function walk(spans: ConversationSpan[]): void {
    for (const span of spans) {
      result.push(span);
      walk(span.children);
    }
  }
  walk(roots);
  return result;
}

export type SpanSelectionMode = 'all' | 'sigil-only';

function filterTree(roots: ConversationSpan[], predicate: (span: ConversationSpan) => boolean): ConversationSpan[] {
  function filterNode(span: ConversationSpan): ConversationSpan | null {
    const filteredChildren = span.children.map(filterNode).filter((child): child is ConversationSpan => child !== null);

    if (predicate(span) || filteredChildren.length > 0) {
      return { ...span, children: filteredChildren };
    }
    return null;
  }
  return roots.map(filterNode).filter((node): node is ConversationSpan => node !== null);
}

export function selectSpansForMode(roots: ConversationSpan[], mode: SpanSelectionMode): ConversationSpan[] {
  if (mode === 'all') {
    return roots;
  }
  return filterTree(roots, (span) => {
    if (isSigilSpan(span)) {
      return true;
    }
    const spanType = getSpanType(span);
    return spanType !== 'unknown';
  });
}

export function filterSpansByType(roots: ConversationSpan[], spanType: SpanType): ConversationSpan[] {
  return filterTree(roots, (span) => getSpanType(span) === spanType);
}

export function filterSpansByText(roots: ConversationSpan[], filter: string): ConversationSpan[] {
  const normalized = filter.trim().toLowerCase();
  if (normalized.length === 0) {
    return roots;
  }
  return filterTree(roots, (span) => spanMatchesFreeText(span, normalized));
}

export function spanMatchesFreeText(span: ConversationSpan, filter: string): boolean {
  const normalized = filter.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  const attrParts: string[] = [];
  for (const [key, value] of span.attributes) {
    if (value.stringValue !== undefined) {
      attrParts.push(`${key}=${value.stringValue}`);
    }
  }
  const searchable = [span.name, span.serviceName, span.traceID, span.spanID, span.parentSpanID, attrParts.join(' ')]
    .join(' ')
    .toLowerCase();
  return searchable.includes(normalized);
}

export function findSpanBySelectionID(roots: ConversationSpan[], selectionID: string): ConversationSpan | null {
  for (const span of roots) {
    if (getSelectionID(span) === selectionID) {
      return span;
    }
    const found = findSpanBySelectionID(span.children, selectionID);
    if (found) {
      return found;
    }
  }
  return null;
}
