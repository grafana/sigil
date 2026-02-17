import { MutableDataFrame, FieldType, type DataFrame } from '@grafana/data';
import type {
  ModelCard,
  ModelCardPricing,
  PrometheusMatrixResult,
  PrometheusQueryResponse,
  PrometheusVectorResult,
} from './types';

export type PricingMap = Map<string, ModelCardPricing>;

/**
 * Build a pricing lookup map from model cards.
 * Indexes by multiple key formats to maximize match rate against
 * the gen_ai_request_model Prometheus label.
 */
export function buildPricingMap(cards: ModelCard[]): PricingMap {
  const map: PricingMap = new Map();
  for (const card of cards) {
    // Key by source_model_id (e.g., "openai/gpt-4o")
    if (card.source_model_id) {
      map.set(card.source_model_id, card.pricing);
    }
    // Key by canonical_slug if different
    if (card.canonical_slug && card.canonical_slug !== card.source_model_id) {
      map.set(card.canonical_slug, card.pricing);
    }
    // Key by just the model part after the provider prefix
    // e.g., "openai/gpt-4o" → "gpt-4o"
    if (card.source_model_id.includes('/')) {
      const modelPart = card.source_model_id.split('/').slice(1).join('/');
      if (modelPart && !map.has(modelPart)) {
        map.set(modelPart, card.pricing);
      }
    }
  }
  return map;
}

/** Look up pricing for a model label, trying multiple key formats. */
export function lookupPricing(pricingMap: PricingMap, model: string, provider?: string): ModelCardPricing | undefined {
  // Direct match
  let pricing = pricingMap.get(model);
  if (pricing) {
    return pricing;
  }
  // Try provider/model format
  if (provider) {
    pricing = pricingMap.get(`${provider}/${model}`);
    if (pricing) {
      return pricing;
    }
  }
  return undefined;
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
export function calculateTotalCost(response: PrometheusQueryResponse | undefined, pricingMap: PricingMap): number {
  if (!response) {
    return 0;
  }
  if (response.data.resultType !== 'vector') {
    return 0;
  }
  const results = response.data.result as PrometheusVectorResult[];
  let total = 0;

  for (const result of results) {
    const model = result.metric.gen_ai_request_model ?? '';
    const provider = result.metric.gen_ai_provider_name;
    const tokenType = result.metric.gen_ai_token_type ?? '';
    const count = parseFloat(result.value[1]);
    const pricing = lookupPricing(pricingMap, model, provider);
    if (!pricing) {
      continue;
    }
    total += tokenCost(tokenType, count, pricing);
  }
  return total;
}

/**
 * Calculate cost-over-time from a Prometheus matrix response
 * containing token rates broken down by model and token type.
 * Returns a single aggregated cost timeseries as a DataFrame.
 */
export function calculateCostTimeSeries(response: PrometheusQueryResponse | undefined, pricingMap: PricingMap): DataFrame {
  if (!response) {
    return new MutableDataFrame({ fields: [] });
  }
  if (response.data.resultType !== 'matrix') {
    return new MutableDataFrame({ fields: [] });
  }
  const results = response.data.result as PrometheusMatrixResult[];

  // Aggregate cost across all series into a single timeseries.
  // First, collect all unique timestamps.
  const costByTime = new Map<number, number>();

  for (const series of results) {
    const model = series.metric.gen_ai_request_model ?? '';
    const provider = series.metric.gen_ai_provider_name;
    const tokenType = series.metric.gen_ai_token_type ?? '';
    const pricing = lookupPricing(pricingMap, model, provider);
    if (!pricing) {
      continue;
    }

    for (const [ts, val] of series.values) {
      const rate = parseFloat(val);
      const cost = tokenCost(tokenType, rate, pricing);
      costByTime.set(ts, (costByTime.get(ts) ?? 0) + cost);
    }
  }

  const sorted = Array.from(costByTime.entries()).sort((a, b) => a[0] - b[0]);
  const times: number[] = [];
  const values: number[] = [];
  for (const [ts, cost] of sorted) {
    times.push(ts * 1000);
    values.push(cost);
  }

  return new MutableDataFrame({
    name: 'Estimated Cost',
    fields: [
      { name: 'Time', type: FieldType.time, values: times },
      {
        name: 'Cost (USD/s)',
        type: FieldType.number,
        values,
        config: { unit: 'currencyUSD' },
      },
    ],
  });
}
