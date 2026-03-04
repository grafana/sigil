import { getSelectionID, getSpanType, hasError, type SpanType } from '../../../conversation/spans';
import type { ConversationSpan } from '../../../conversation/types';

const NS_PER_US = BigInt(1_000);
const NS_PER_MS = BigInt(1_000_000);
const NS_PER_SECOND = BigInt(1_000_000_000);

export type SigilSpanTreeRow = {
  span: ConversationSpan;
  selectionID: string;
  parentSelectionID?: string;
  childSelectionIDs: string[];
  ancestorSelectionIDs: string[];
  depth: number;
  hasChildren: boolean;
  spanType: SpanType;
  operationName: string;
  serviceName: string;
  durationLabel: string;
  hasError: boolean;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
  durationNano: bigint;
};

export type SigilSpanTreeResult = {
  rows: SigilSpanTreeRow[];
  traceStartNano: bigint;
  traceEndNano: bigint;
};

export function toMicroseconds(nanos: bigint): number {
  return Number(nanos / NS_PER_US);
}

export function formatDurationNs(durationNs: bigint): string {
  if (durationNs >= NS_PER_SECOND) {
    return `${(Number(durationNs) / Number(NS_PER_SECOND)).toFixed(2)}s`;
  }
  if (durationNs >= NS_PER_MS) {
    return `${(Number(durationNs) / Number(NS_PER_MS)).toFixed(2)}ms`;
  }
  if (durationNs >= NS_PER_US) {
    return `${(Number(durationNs) / Number(NS_PER_US)).toFixed(2)}us`;
  }
  return `${durationNs.toString()}ns`;
}

export function buildSigilSpanTreeRows(roots: ConversationSpan[]): SigilSpanTreeResult {
  const rows: SigilSpanTreeRow[] = [];
  const parentBySelectionID = new Map<string, string | undefined>();
  let traceStartNano = BigInt(0);
  let traceEndNano = BigInt(0);
  let hasTimingData = false;

  function walk(span: ConversationSpan, depth: number, parentSelectionID?: string): void {
    const selectionID = getSelectionID(span);
    parentBySelectionID.set(selectionID, parentSelectionID);

    const childSelectionIDs = span.children.map((child) => getSelectionID(child));

    rows.push({
      span,
      selectionID,
      parentSelectionID,
      childSelectionIDs,
      ancestorSelectionIDs: [],
      depth,
      hasChildren: span.children.length > 0,
      spanType: getSpanType(span),
      operationName: span.name,
      serviceName: span.serviceName,
      durationLabel: formatDurationNs(span.durationNano),
      hasError: hasError(span),
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.endTimeUnixNano,
      durationNano: span.durationNano,
    });

    for (const child of span.children) {
      walk(child, depth + 1, selectionID);
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  for (const row of rows) {
    const ancestors: string[] = [];
    let current = row.parentSelectionID;
    while (current != null) {
      ancestors.unshift(current);
      current = parentBySelectionID.get(current);
    }
    row.ancestorSelectionIDs = ancestors;

    if (!hasTimingData) {
      traceStartNano = row.startTimeUnixNano;
      traceEndNano = row.endTimeUnixNano;
      hasTimingData = true;
    } else {
      if (row.startTimeUnixNano < traceStartNano) {
        traceStartNano = row.startTimeUnixNano;
      }
      if (row.endTimeUnixNano > traceEndNano) {
        traceEndNano = row.endTimeUnixNano;
      }
    }
  }

  return { rows, traceStartNano, traceEndNano };
}
