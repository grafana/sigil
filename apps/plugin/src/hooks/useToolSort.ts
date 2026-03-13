import { useCallback, useMemo, useState } from 'react';
import { sortToolRows, type ToolSortKey, type ToolSortDirection, type ToolSummaryRow } from '../dashboard/toolRuntimeTable';

type UseToolSortResult = {
  sortKey: ToolSortKey;
  sortDirection: ToolSortDirection;
  handleSortChange: (nextKey: ToolSortKey) => void;
  sortRows: (rows: ToolSummaryRow[]) => ToolSummaryRow[];
};

export function useToolSort(
  defaultKey: ToolSortKey = 'executions',
  defaultDirection: ToolSortDirection = 'desc'
): UseToolSortResult {
  const [sortKey, setSortKey] = useState<ToolSortKey>(defaultKey);
  const [sortDirection, setSortDirection] = useState<ToolSortDirection>(defaultDirection);

  const handleSortChange = useCallback(
    (nextKey: ToolSortKey) => {
      if (nextKey === sortKey) {
        setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
        return;
      }
      setSortKey(nextKey);
      setSortDirection(nextKey === 'toolName' ? 'asc' : 'desc');
    },
    [sortKey]
  );

  const sortRows = useCallback(
    (rows: ToolSummaryRow[]) => sortToolRows(rows, sortKey, sortDirection),
    [sortKey, sortDirection]
  );

  return useMemo(
    () => ({ sortKey, sortDirection, handleSortChange, sortRows }),
    [sortKey, sortDirection, handleSortChange, sortRows]
  );
}
