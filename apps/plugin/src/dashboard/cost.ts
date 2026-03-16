import { MutableDataFrame, FieldType, type DataFrame } from '@grafana/data';
import type {
  ModelCardPricing,
  PrometheusMatrixResult,
  PrometheusQueryResponse,
  PrometheusVectorResult,
} from './types';

export type PricingMap = Map<string, ModelCardPricing>;

export type PricingEntry = {
  provider: string;
  model: string;
  pricing: ModelCardPricing;
};

export type UnresolvedCostSeries = {
  provider: string;
  model: string;
  tokenType: string;
  count: number;
};

export type TotalCostResult = {
  totalCost: number;
  unresolvedTokens: number;
  unresolvedSeries: UnresolvedCostSeries[];
};

export function averageCost(totalCost: number, count: number): number {
  if (!Number.isFinite(totalCost) || !Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return totalCost / count;
}

export function pricingKey(provider: string, model: string): string {
  return `${provider.trim().toLowerCase()}::${model.trim()}`;
}

export function buildPricingMap(entries: PricingEntry[]): PricingMap {
  const map: PricingMap = new Map();
  for (const entry of entries) {
    map.set(pricingKey(entry.provider, entry.model), entry.pricing);
  }
  return map;
}

export function lookupPricing(pricingMap: PricingMap, model: string, provider?: string): ModelCardPricing | undefined {
  const normalizedProvider = provider?.trim().toLowerCase() ?? '';
  const normalizedModel = model.trim();
  if (!normalizedProvider || !normalizedModel) {
    return undefined;
  }
  return pricingMap.get(pricingKey(normalizedProvider, normalizedModel));
}

function tokenCost(tokenType: string, count: number, pricing: ModelCardPricing): number {
  switch (tokenType) {
    case 'input':
      return count * (pricing.prompt_usd_per_token ?? 0);
    case 'output':
      return count * (pricing.completion_usd_per_token ?? 0);
    case 'cache_read':
      return count * (pricing.input_cache_read_usd_per_token ?? 0);
    case 'cache_write':
    case 'cache_creation':
      return count * (pricing.input_cache_write_usd_per_token ?? 0);
    default:
      return 0;
  }
}

/**
 * Calculate total cost from a Prometheus vector response
 * that contains token counts broken down by model and token type.
 */
export function calculateTotalCost(
  response: PrometheusQueryResponse | undefined,
  pricingMap: PricingMap
): TotalCostResult {
  if (!response) {
    return { totalCost: 0, unresolvedTokens: 0, unresolvedSeries: [] };
  }
  if (response.data.resultType !== 'vector') {
    return { totalCost: 0, unresolvedTokens: 0, unresolvedSeries: [] };
  }
  const results = response.data.result as PrometheusVectorResult[];
  let total = 0;
  let unresolvedTokens = 0;
  const unresolvedSeries: UnresolvedCostSeries[] = [];

  for (const result of results) {
    const model = result.metric.gen_ai_request_model ?? '';
    const provider = result.metric.gen_ai_provider_name;
    const tokenType = result.metric.gen_ai_token_type ?? '';
    const count = parseFloat(result.value[1]);
    const pricing = lookupPricing(pricingMap, model, provider);
    if (!pricing) {
      unresolvedTokens += count;
      unresolvedSeries.push({
        provider: provider ?? '',
        model,
        tokenType,
        count,
      });
      continue;
    }
    total += tokenCost(tokenType, count, pricing);
  }
  return { totalCost: total, unresolvedTokens, unresolvedSeries };
}

export type GroupedCostEntry = {
  label: string;
  cost: number;
};

/**
 * Calculate total cost grouped by a Prometheus label.
 * Returns one entry per unique value of groupByLabel.
 */
export function calculateTotalCostByGroup(
  response: PrometheusQueryResponse | undefined,
  pricingMap: PricingMap,
  groupByLabel: string
): GroupedCostEntry[] {
  if (!response || response.data.resultType !== 'vector') {
    return [];
  }
  const results = response.data.result as PrometheusVectorResult[];
  const groups = new Map<string, number>();

  for (const result of results) {
    const model = result.metric.gen_ai_request_model ?? '';
    const provider = result.metric.gen_ai_provider_name;
    const tokenType = result.metric.gen_ai_token_type ?? '';
    const count = parseFloat(result.value[1]);
    const pricing = lookupPricing(pricingMap, model, provider);
    if (!pricing) {
      continue;
    }
    const cost = tokenCost(tokenType, count, pricing);
    const groupKey = result.metric[groupByLabel] ?? 'unknown';
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + cost);
  }

  return Array.from(groups.entries()).map(([label, cost]) => ({ label, cost }));
}

/**
 * Calculate cost-over-time from a Prometheus matrix response
 * containing token rates broken down by model and token type.
 *
 * When groupByLabel is provided, returns one DataFrame per unique value of
 * that label (e.g. one line per provider). Otherwise returns a single
 * aggregated cost timeseries.
 */
export function calculateCostTimeSeries(
  response: PrometheusQueryResponse | undefined,
  pricingMap: PricingMap,
  groupByLabel?: string
): DataFrame[] {
  if (!response) {
    return [];
  }
  if (response.data.resultType !== 'matrix') {
    return [];
  }
  const results = response.data.result as PrometheusMatrixResult[];

  // groupKey → (timestamp → cost)
  const groups = new Map<string, Map<number, number>>();

  for (const series of results) {
    const model = series.metric.gen_ai_request_model ?? '';
    const provider = series.metric.gen_ai_provider_name;
    const tokenType = series.metric.gen_ai_token_type ?? '';
    const pricing = lookupPricing(pricingMap, model, provider);
    if (!pricing) {
      continue;
    }

    const groupKey = groupByLabel ? (series.metric[groupByLabel] ?? 'unknown') : '__all__';
    let costByTime = groups.get(groupKey);
    if (!costByTime) {
      costByTime = new Map<number, number>();
      groups.set(groupKey, costByTime);
    }

    for (const [ts, val] of series.values) {
      const rate = parseFloat(val);
      const cost = tokenCost(tokenType, rate, pricing);
      costByTime.set(ts, (costByTime.get(ts) ?? 0) + cost);
    }
  }

  const frames: DataFrame[] = [];
  for (const [groupKey, costByTime] of groups) {
    const sorted = Array.from(costByTime.entries()).sort((a, b) => a[0] - b[0]);
    const times: number[] = [];
    const values: number[] = [];
    for (const [ts, cost] of sorted) {
      times.push(ts * 1000);
      values.push(cost);
    }

    const name = groupByLabel ? groupKey : 'Estimated Cost';
    frames.push(
      new MutableDataFrame({
        name,
        fields: [
          { name: 'Time', type: FieldType.time, values: times },
          {
            name: 'Cost (USD/s)',
            type: FieldType.number,
            values,
            config: { unit: 'currencyUSD', displayName: name },
          },
        ],
      })
    );
  }

  return frames;
}
