import type { PrometheusQueryResponse } from '../../dashboard/types';

function formatPrometheusValue(raw: string): string {
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) {
    return 'no data';
  }
  return raw;
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
  const lines = results.map((r) => {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `  ${tags || 'total'}: ${formatPrometheusValue(r.value[1])}`;
  });
  return `${label} (by series):\n${lines.join('\n')}`;
}

export function summarizeMatrix(response: PrometheusQueryResponse | null | undefined, label: string): string {
  if (!response || response.data.resultType !== 'matrix') {
    return `${label}: no data`;
  }
  const results = response.data.result as Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  if (results.length === 0) {
    return `${label}: no series`;
  }
  const seriesLines: string[] = [];
  for (const r of results) {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const numericVals = r.values.map(([, v]) => parseFloat(v)).filter((n) => Number.isFinite(n));

    if (numericVals.length === 0) {
      continue;
    }

    const first = numericVals[0];
    const last = numericVals[numericVals.length - 1];
    const min = Math.min(...numericVals);
    const max = Math.max(...numericVals);
    const avg = numericVals.reduce((sum, v) => sum + v, 0) / numericVals.length;
    seriesLines.push(
      `  ${tags || 'total'}: first=${first}, last=${last}, min=${min}, max=${max}, avg=${avg.toFixed(4)}, points=${numericVals.length}`
    );
  }
  if (seriesLines.length === 0) {
    return `${label}: no data`;
  }
  return `${label} (${seriesLines.length} series):\n${seriesLines.join('\n')}`;
}
