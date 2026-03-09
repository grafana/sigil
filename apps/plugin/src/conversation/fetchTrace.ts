import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type { TraceFetchOptions, TraceFetcher } from './loader';

type FetchError = {
  status?: number;
};

function toUnixSeconds(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.floor(value / 1000));
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : String(Math.floor(parsed / 1000));
  }
  if (typeof value === 'object' && typeof (value as { valueOf?: () => number }).valueOf === 'function') {
    const parsed = Number((value as { valueOf: () => number }).valueOf());
    return Number.isFinite(parsed) ? String(Math.floor(parsed / 1000)) : null;
  }
  return null;
}

function buildTempoTraceURL(traceID: string, options?: TraceFetchOptions): string {
  const url = new URL(
    `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`,
    window.location.origin
  );
  const start = toUnixSeconds(options?.timeRange?.from);
  const end = toUnixSeconds(options?.timeRange?.to);
  if (start) {
    url.searchParams.set('start', start);
  }
  if (end) {
    url.searchParams.set('end', end);
  }
  return url.toString();
}

export async function fetchTempoTrace(traceID: string, options?: TraceFetchOptions): Promise<unknown> {
  const fetchTrace = async (requestOptions?: TraceFetchOptions) => {
    const response = await lastValueFrom(
      getBackendSrv().fetch<unknown>({
        method: 'GET',
        url: buildTempoTraceURL(traceID, requestOptions),
        showErrorAlert: false,
      })
    );
    return response.data;
  };

  try {
    return await fetchTrace(options);
  } catch (error) {
    if ((error as FetchError).status === 404 && options?.timeRange) {
      return fetchTrace();
    }
    throw error;
  }
}

export function createTempoTraceFetcher(): TraceFetcher {
  return async (traceID: string, options?: TraceFetchOptions) => fetchTempoTrace(traceID, options);
}
