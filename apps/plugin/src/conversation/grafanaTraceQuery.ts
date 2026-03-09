import type { TimeRange } from '@grafana/data';
import { normalizeTraceID } from './ids';

function toUnixSeconds(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value / 1000);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
  }
  if (typeof value === 'object' && typeof (value as { valueOf?: () => number }).valueOf === 'function') {
    const parsed = Number((value as { valueOf: () => number }).valueOf());
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
  }
  return undefined;
}

export function buildGrafanaTraceQuery(traceID: string, timeRange: TimeRange) {
  const normalizedTraceID = normalizeTraceID(traceID) || traceID;
  const start = toUnixSeconds(timeRange.from);
  const end = toUnixSeconds(timeRange.to);

  return {
    refId: 'A',
    query: normalizedTraceID,
    queryType: 'traceql' as const,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };
}
