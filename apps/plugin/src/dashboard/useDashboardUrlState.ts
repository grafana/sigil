import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { type BreakdownDimension, type CostMode, type DashboardFilters, type LabelFilter, type LatencyPercentile } from './types';

const BREAKDOWN_VALUES = new Set<BreakdownDimension>(['none', 'provider', 'model', 'agent']);
const LATENCY_PERCENTILE_VALUES = new Set<LatencyPercentile>(['p50', 'p95', 'p99']);
const COST_MODE_VALUES = new Set<CostMode>(['usd', 'tokens']);

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

function parseLabelFilters(params: URLSearchParams): LabelFilter[] {
  const raw = params.getAll('label');
  const filters: LabelFilter[] = [];
  for (const entry of raw) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx > 0) {
      filters.push({ key: entry.slice(0, colonIdx), value: entry.slice(colonIdx + 1) });
    }
  }
  return filters;
}

function parseFilters(params: URLSearchParams): DashboardFilters {
  return {
    provider: params.get('provider') || '',
    model: params.get('model') || '',
    agentName: params.get('agent') || '',
    labelFilters: parseLabelFilters(params),
  };
}

function parseBreakdown(params: URLSearchParams): BreakdownDimension {
  const v = params.get('breakdownBy') as BreakdownDimension;
  return BREAKDOWN_VALUES.has(v) ? v : 'provider';
}

function parseLatencyPercentile(params: URLSearchParams): LatencyPercentile {
  const v = params.get('latency') as LatencyPercentile;
  return LATENCY_PERCENTILE_VALUES.has(v) ? v : 'p95';
}

function parseCostMode(params: URLSearchParams): CostMode {
  const v = params.get('costMode') as CostMode;
  return COST_MODE_VALUES.has(v) ? v : 'usd';
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue = ''): void {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

export type DashboardUrlState = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  latencyPercentile: LatencyPercentile;
  costMode: CostMode;
  setTimeRange: (tr: TimeRange) => void;
  setFilters: (f: DashboardFilters) => void;
  setBreakdownBy: (b: BreakdownDimension) => void;
  setLatencyPercentile: (p: LatencyPercentile) => void;
  setCostMode: (m: CostMode) => void;
};

export function useDashboardUrlState(): DashboardUrlState {
  const [searchParams, setSearchParams] = useSearchParams();

  const timeRange = useMemo(() => parseTimeRange(searchParams), [searchParams]);
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const breakdownBy = useMemo(() => parseBreakdown(searchParams), [searchParams]);
  const latencyPercentile = useMemo(() => parseLatencyPercentile(searchParams), [searchParams]);
  const costMode = useMemo(() => parseCostMode(searchParams), [searchParams]);

  const setTimeRange = useCallback(
    (tr: TimeRange) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'from', String(tr.raw.from), DEFAULT_FROM);
          setOrDelete(next, 'to', String(tr.raw.to), DEFAULT_TO);
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
          setOrDelete(next, 'provider', f.provider);
          setOrDelete(next, 'model', f.model);
          setOrDelete(next, 'agent', f.agentName);
          next.delete('label');
          for (const lf of f.labelFilters) {
            if (lf.key && lf.value) {
              next.append('label', `${lf.key}:${lf.value}`);
            }
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setBreakdownBy = useCallback(
    (b: BreakdownDimension) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'breakdownBy', b, 'provider');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setLatencyPercentile = useCallback(
    (p: LatencyPercentile) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'latency', p, 'p95');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setCostMode = useCallback(
    (m: CostMode) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'costMode', m, 'usd');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return {
    timeRange, filters, breakdownBy, latencyPercentile, costMode,
    setTimeRange, setFilters, setBreakdownBy, setLatencyPercentile, setCostMode,
  };
}
