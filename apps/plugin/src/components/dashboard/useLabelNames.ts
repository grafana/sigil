import { useEffect, useRef, useState } from 'react';
import type { DashboardDataSource } from '../../dashboard/api';

type LabelNamesResult = {
  names: string[];
  loading: boolean;
};

export function useLabelNames(
  dataSource: DashboardDataSource,
  from: number,
  to: number,
  matchers?: string
): LabelNamesResult {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const versionRef = useRef(0);

  useEffect(() => {
    const version = ++versionRef.current;
    setLoading(true);

    const run = async () => {
      try {
        const result = await dataSource.labels(from, to, matchers);
        if (versionRef.current === version) {
          setNames(result);
        }
      } catch {
        if (versionRef.current === version) {
          setNames([]);
        }
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
        }
      }
    };

    run();
  }, [dataSource, from, to, matchers]);

  return { names, loading };
}
