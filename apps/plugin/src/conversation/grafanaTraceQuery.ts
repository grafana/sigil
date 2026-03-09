import type { TimeRange } from '@grafana/data';
import { normalizeTraceID } from './ids';
import { toUnixSeconds } from './timeRange';

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
