import { MutableDataFrame, FieldType, type DataFrame } from '@grafana/data';
import type { PrometheusMatrixResult, PrometheusQueryResponse, PrometheusVectorResult } from './types';

type LabelStringOptions = {
  preferredKeys?: string[];
  separator?: string;
};

/** Build a display label from a set of Prometheus labels. */
function labelString(metric: Record<string, string>, options?: LabelStringOptions): string {
  const preferredKeys = options?.preferredKeys ?? [
    'error_type',
    'gen_ai_token_type',
    'gen_ai_provider_name',
    'gen_ai_request_model',
    'gen_ai_agent_name',
  ];
  const separator = options?.separator ?? ' / ';

  const preferredValues = preferredKeys.map((key) => metric[key]).filter(Boolean);
  if (preferredValues.length > 0) {
    const uniquePreferred = [...new Set(preferredValues)];
    return uniquePreferred.join(separator);
  }

  const values = Object.entries(metric)
    .filter(([key, value]) => Boolean(value) && key !== '__name__' && !key.startsWith('__'))
    .map(([, value]) => value);

  const uniqueValues = [...new Set(values)];
  return uniqueValues.join(separator) || 'Value';
}

function uniqueFieldName(name: string, counts: Map<string, number>): string {
  const count = counts.get(name);
  if (!count) {
    counts.set(name, 1);
    return name;
  }
  const next = count + 1;
  counts.set(name, next);
  return `${name} (${next})`;
}

export function vectorToPieDataFrame(
  response: PrometheusQueryResponse,
  labelKeys: string[],
  separator = ' / '
): DataFrame {
  if (response.data.resultType !== 'vector') {
    return new MutableDataFrame({ fields: [] });
  }

  const results = response.data.result as PrometheusVectorResult[];

  const tagged = results.map((result, idx) => {
    const baseName = labelString(result.metric, { preferredKeys: labelKeys, separator }) || `Series ${idx + 1}`;
    return { baseName, result };
  });
  tagged.sort((a, b) => a.baseName.localeCompare(b.baseName));

  const fieldNameCounts = new Map<string, number>();
  const fields = tagged.map(({ baseName, result }) => {
    const name = uniqueFieldName(baseName, fieldNameCounts);
    return {
      name,
      type: FieldType.number,
      values: [parseFloat(result.value[1])],
      labels: result.metric,
      config: { displayName: name },
    };
  });

  return new MutableDataFrame({ fields });
}

/** Convert a Prometheus matrix (query_range) response to Grafana DataFrames. */
export function matrixToDataFrames(response: PrometheusQueryResponse): DataFrame[] {
  if (response.data.resultType !== 'matrix') {
    return [];
  }
  const results = response.data.result as PrometheusMatrixResult[];

  const frames = results.map((series) => {
    const name = labelString(series.metric);
    const times: number[] = [];
    const values: number[] = [];

    for (const [ts, val] of series.values) {
      times.push(ts * 1000); // Prometheus uses seconds, Grafana uses milliseconds
      values.push(parseFloat(val));
    }

    return new MutableDataFrame({
      name,
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        {
          name: 'Value',
          type: FieldType.number,
          values,
          labels: series.metric,
          config: { displayName: name },
        },
      ],
    });
  });

  frames.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return frames;
}

/** Convert a Prometheus vector (instant) response to a single DataFrame for pie/bar charts. */
export function vectorToDataFrame(response: PrometheusQueryResponse, valueName = 'Value'): DataFrame {
  if (response.data.resultType !== 'vector') {
    return new MutableDataFrame({ fields: [] });
  }
  const results = response.data.result as PrometheusVectorResult[];

  const labels: string[] = [];
  const values: number[] = [];

  for (const result of results) {
    labels.push(labelString(result.metric));
    values.push(parseFloat(result.value[1]));
  }

  return new MutableDataFrame({
    fields: [
      { name: 'Label', type: FieldType.string, values: labels },
      { name: valueName, type: FieldType.number, values },
    ],
  });
}

/** Extract a single scalar from a Prometheus vector response. */
export function vectorToStatValue(response: PrometheusQueryResponse): number {
  if (response.data.resultType !== 'vector') {
    return 0;
  }
  const results = response.data.result as PrometheusVectorResult[];
  if (results.length === 0) {
    return 0;
  }
  return parseFloat(results[0].value[1]);
}

/** Convert a single scalar value to a stat-compatible DataFrame. */
export function statValueToDataFrame(value: number, name: string, unit?: string): DataFrame {
  return new MutableDataFrame({
    fields: [
      {
        name,
        type: FieldType.number,
        values: [value],
        config: unit ? { unit } : {},
      },
    ],
  });
}
