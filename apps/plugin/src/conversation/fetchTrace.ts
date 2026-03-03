import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type { TraceFetcher } from './loader';

export function createTempoTraceFetcher(): TraceFetcher {
  return async (traceID: string) => {
    const url = new URL(
      `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`,
      window.location.origin
    );
    const response = await lastValueFrom(getBackendSrv().fetch<unknown>({ method: 'GET', url: url.toString() }));
    return response.data;
  };
}
