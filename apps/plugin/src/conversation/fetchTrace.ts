import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type { TraceFetchOptions, TraceFetcher } from './loader';
import { toUnixSeconds } from './timeRange';

type FetchError = {
  status?: number;
};

function toUnixSecondsString(value: unknown): string | null {
  const result = toUnixSeconds(value);
  return result !== undefined ? String(result) : null;
}

function buildTempoTraceURL(traceID: string, options?: TraceFetchOptions): string {
  const url = new URL(
    `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`,
    window.location.origin
  );
  const start = toUnixSecondsString(options?.timeRange?.from);
  const end = toUnixSecondsString(options?.timeRange?.to);
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
