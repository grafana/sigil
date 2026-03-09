import type { PrometheusQueryResponse } from '../../dashboard/types';

export function compactNumber(num: number): string {
  if (num === 0) {
    return '0';
  }
  const abs = Math.abs(num);
  let s: string;
  if (abs >= 1000) {
    s = String(Math.round(num));
  } else if (abs >= 1) {
    s = num.toFixed(3);
  } else {
    s = num.toFixed(6);
  }
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

function formatPrometheusValue(raw: string): string {
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) {
    return 'no data';
  }
  return compactNumber(num);
}

/**
 * When all series share exactly one label key, return that key so callers
 * can emit just the value instead of key=value for every line.
 */
export function findSharedLabelKey(results: Array<{ metric: Record<string, string> }>): string | null {
  let sharedKey: string | null = null;
  for (const r of results) {
    const keys = Object.keys(r.metric).filter((k) => !k.startsWith('__'));
    if (keys.length !== 1) {
      return null;
    }
    if (sharedKey === null) {
      sharedKey = keys[0];
    } else if (sharedKey !== keys[0]) {
      return null;
    }
  }
  return sharedKey;
}

export function formatMetricLabels(metric: Record<string, string>, sharedKey: string | null): string {
  const entries = Object.entries(metric).filter(([k]) => !k.startsWith('__'));
  if (entries.length === 0) {
    return 'total';
  }
  if (sharedKey && entries.length === 1 && entries[0][0] === sharedKey) {
    return entries[0][1];
  }
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}

export function hasResponseData(response: PrometheusQueryResponse | null | undefined): boolean {
  if (!response) {
    return false;
  }
  if (response.data.resultType !== 'vector' && response.data.resultType !== 'matrix') {
    return false;
  }
  return response.data.result.length > 0;
}

export function summarizeVector(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'vector') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; value: [number, string] }>;
  if (results.length === 0) {
    return `${label}: 0`;
  }
  if (results.length === 1) {
    return `${label}: ${formatPrometheusValue(results[0].value[1])}`;
  }

  const sharedKey = findSharedLabelKey(results);
  const nonZero: typeof results = [];
  let zeroCount = 0;
  for (const r of results) {
    const num = parseFloat(r.value[1]);
    if (Number.isFinite(num) && num === 0) {
      zeroCount++;
    } else {
      nonZero.push(r);
    }
  }

  if (nonZero.length === 0) {
    return `${label}: all ${zeroCount} series are 0`;
  }

  const lines = nonZero.map((r) => {
    const tags = formatMetricLabels(r.metric, sharedKey);
    return `  ${tags}: ${formatPrometheusValue(r.value[1])}`;
  });
  if (zeroCount > 0) {
    lines.push(`  (${zeroCount} others: 0)`);
  }

  return `${label}:\n${lines.join('\n')}`;
}

export function summarizeMatrix(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'matrix') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  if (results.length === 0) {
    return `${label}: no series`;
  }

  const sharedKey = findSharedLabelKey(results);
  const seriesLines: string[] = [];
  let zeroSeriesCount = 0;

  for (const r of results) {
    const numericVals = r.values.map(([, v]) => parseFloat(v)).filter((n) => Number.isFinite(n));
    if (numericVals.length === 0) {
      continue;
    }

    const min = Math.min(...numericVals);
    const max = Math.max(...numericVals);
    if (max === 0 && min === 0) {
      zeroSeriesCount++;
      continue;
    }

    const tags = formatMetricLabels(r.metric, sharedKey);
    if (min === max) {
      seriesLines.push(`  ${tags}: constant=${compactNumber(min)}`);
    } else {
      const first = numericVals[0];
      const last = numericVals[numericVals.length - 1];
      const avg = numericVals.reduce((sum, v) => sum + v, 0) / numericVals.length;
      seriesLines.push(
        `  ${tags}: first=${compactNumber(first)}, last=${compactNumber(last)}, min=${compactNumber(min)}, max=${compactNumber(max)}, avg=${compactNumber(avg)}`
      );
    }
  }

  if (seriesLines.length === 0 && zeroSeriesCount > 0) {
    return `${label}: all ${zeroSeriesCount} series are 0`;
  }
  if (seriesLines.length === 0) {
    return `${label}: no data`;
  }

  const activeSeries = seriesLines.length;
  if (zeroSeriesCount > 0) {
    seriesLines.push(`  (${zeroSeriesCount} others: all zeros)`);
  }

  return `${label} (${activeSeries} series):\n${seriesLines.join('\n')}`;
}
