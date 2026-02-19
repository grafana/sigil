import { useState, useEffect, useRef } from 'react';
import type { DashboardDataSource } from '../../dashboard/api';

type LabelValuesResult = {
  values: string[];
  loading: boolean;
};

export function useLabelValues(
  dataSource: DashboardDataSource,
  label: string,
  from: number,
  to: number
): LabelValuesResult {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const versionRef = useRef(0);

  useEffect(() => {
    if (!label) {
      setValues([]);
      setLoading(false);
      return;
    }

    const version = ++versionRef.current;
    setLoading(true);

    const run = async () => {
      try {
        const result = await dataSource.labelValues(label, from, to);
        if (versionRef.current === version) {
          setValues(result);
        }
      } catch {
        if (versionRef.current === version) {
          setValues([]);
        }
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
        }
      }
    };

    run();
  }, [dataSource, label, from, to]);

  return { values, loading };
}
