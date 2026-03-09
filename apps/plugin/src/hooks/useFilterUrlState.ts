import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { type DashboardFilters, type FilterOperator, FILTER_OPERATORS, type LabelFilter } from '../dashboard/types';

const DEFAULT_FROM = 'now-1h';
const DEFAULT_TO = 'now';

function parseTimeRange(params: URLSearchParams): TimeRange {
  const rawFrom = params.get('from') || DEFAULT_FROM;
  const rawTo = params.get('to') || DEFAULT_TO;
  return {
    from: dateTimeParse(rawFrom),
    to: dateTimeParse(rawTo),
    raw: { from: rawFrom, to: rawTo },
  };
}

// URL format: key|operator|value  (pipe-delimited)
// Falls back to key:value for backward compat (assumes '=' operator).
function parseLabelFilters(params: URLSearchParams): LabelFilter[] {
  const raw = params.getAll('label');
  const filters: LabelFilter[] = [];
  for (const entry of raw) {
    const pipeIdx = entry.indexOf('|');
    if (pipeIdx > 0) {
      const key = entry.slice(0, pipeIdx);
      const rest = entry.slice(pipeIdx + 1);
      const secondPipe = rest.indexOf('|');
      if (secondPipe > 0) {
        const op = rest.slice(0, secondPipe) as FilterOperator;
        const value = rest.slice(secondPipe + 1);
        filters.push({ key, operator: FILTER_OPERATORS.includes(op) ? op : '=', value });
        continue;
      }
    }
    const colonIdx = entry.indexOf(':');
    if (colonIdx > 0) {
      filters.push({ key: entry.slice(0, colonIdx), operator: '=', value: entry.slice(colonIdx + 1) });
    }
  }
  return filters;
}

function parseMulti(params: URLSearchParams, key: string): string[] {
  return params.getAll(key).filter(Boolean);
}

function parseFilters(params: URLSearchParams): DashboardFilters {
  return {
    providers: parseMulti(params, 'provider'),
    models: parseMulti(params, 'model'),
    agentNames: parseMulti(params, 'agent'),
    labelFilters: parseLabelFilters(params),
  };
}

function serializeRawTime(raw: string | { toISOString(): string }): string {
  if (typeof raw === 'string') {
    return raw;
  }
  return raw.toISOString();
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue = ''): void {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

function setMulti(params: URLSearchParams, key: string, values: string[]): void {
  params.delete(key);
  for (const v of values) {
    if (v) {
      params.append(key, v);
    }
  }
}

export type FilterUrlState = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  searchParams: URLSearchParams;
  setTimeRange: (tr: TimeRange) => void;
  setFilters: (f: DashboardFilters) => void;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
};

export function useFilterUrlState(): FilterUrlState {
  const [searchParams, setSearchParams] = useSearchParams();

  const timeRange = useMemo(() => parseTimeRange(searchParams), [searchParams]);
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const setTimeRange = useCallback(
    (tr: TimeRange) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'from', serializeRawTime(tr.raw.from), DEFAULT_FROM);
          setOrDelete(next, 'to', serializeRawTime(tr.raw.to), DEFAULT_TO);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setFilters = useCallback(
    (f: DashboardFilters) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setMulti(next, 'provider', f.providers);
          setMulti(next, 'model', f.models);
          setMulti(next, 'agent', f.agentNames);
          next.delete('label');
          for (const lf of f.labelFilters) {
            if (lf.key && lf.value) {
              next.append('label', `${lf.key}|${lf.operator}|${lf.value}`);
            }
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return {
    timeRange,
    filters,
    searchParams,
    setTimeRange,
    setFilters,
    setSearchParams,
  };
}
