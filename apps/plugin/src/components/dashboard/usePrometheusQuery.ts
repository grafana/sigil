import { useState, useEffect, useRef } from 'react';
import type { DashboardDataSource } from '../../dashboard/api';
import type { PrometheusQueryResponse } from '../../dashboard/types';

type QueryType = 'range' | 'instant';

type PrometheusQueryResult = {
  data: PrometheusQueryResponse | null;
  loading: boolean;
  error: string;
};

export function usePrometheusQuery(
  dataSource: DashboardDataSource,
  query: string,
  from: number,
  to: number,
  type: QueryType,
  step?: number
): PrometheusQueryResult {
  const [data, setData] = useState<PrometheusQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const versionRef = useRef(0);

  useEffect(() => {
    if (!query) {
      setData(null);
      return;
    }

    const version = ++versionRef.current;
    setLoading(true);
    setError('');

    const run = async () => {
      try {
        let response: PrometheusQueryResponse;
        if (type === 'range') {
          response = await dataSource.queryRange(query, from, to, step ?? 60);
        } else {
          response = await dataSource.queryInstant(query, to);
        }
        if (versionRef.current !== version) {
          return;
        }
        if (response.status === 'error') {
          setError(response.error ?? 'Query failed');
          setData(null);
        } else {
          setData(response);
        }
      } catch (err) {
        if (versionRef.current !== version) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Query failed');
        setData(null);
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
        }
      }
    };

    run();
  }, [dataSource, query, from, to, type, step]);

  return { data, loading, error };
}
