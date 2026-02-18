import { buildPricingMap, calculateCostTimeSeries, calculateTotalCost, lookupPricing, pricingKey } from './cost';
import type { ModelCardPricing, PrometheusQueryResponse } from './types';

const basePricing: ModelCardPricing = {
  prompt_usd_per_token: null,
  completion_usd_per_token: null,
  request_usd: null,
  image_usd: null,
  web_search_usd: null,
  input_cache_read_usd_per_token: null,
  input_cache_write_usd_per_token: null,
};

function makePricing(overrides: Partial<ModelCardPricing>): ModelCardPricing {
  return { ...basePricing, ...overrides };
}

describe('buildPricingMap', () => {
  it('indexes by strict provider and model key', () => {
    const map = buildPricingMap([
      {
        provider: 'OpenAI',
        model: 'gpt-4o',
        pricing: makePricing({ prompt_usd_per_token: 0.0025 }),
      },
    ]);

    expect(map.get(pricingKey('openai', 'gpt-4o'))).toBeDefined();
    expect(map.get(pricingKey('anthropic', 'gpt-4o'))).toBeUndefined();
  });
});

describe('lookupPricing', () => {
  const map = buildPricingMap([
    {
      provider: 'openai',
      model: 'gpt-4o',
      pricing: makePricing({ prompt_usd_per_token: 0.0025 }),
    },
  ]);

  it('matches exact provider and model', () => {
    expect(lookupPricing(map, 'gpt-4o', 'openai')).toBeDefined();
  });

  it('returns undefined without provider', () => {
    expect(lookupPricing(map, 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined for mismatched provider', () => {
    expect(lookupPricing(map, 'gpt-4o', 'anthropic')).toBeUndefined();
  });
});

describe('calculateTotalCost', () => {
  const pricingMap = buildPricingMap([
    {
      provider: 'openai',
      model: 'gpt-4o',
      pricing: makePricing({
        prompt_usd_per_token: 0.0025,
        completion_usd_per_token: 0.01,
        input_cache_read_usd_per_token: 0.00125,
        input_cache_write_usd_per_token: 0.00375,
      }),
    },
  ]);

  it('computes cost from token counts', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
            value: [0, '1000'],
          },
          {
            metric: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'output' },
            value: [0, '500'],
          },
        ],
      },
    };

    const cost = calculateTotalCost(response, pricingMap);
    expect(cost.totalCost).toBeCloseTo(7.5);
    expect(cost.unresolvedTokens).toBe(0);
    expect(cost.unresolvedSeries).toEqual([]);
  });

  it('tracks unresolved series when no exact provider/model pricing exists', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: {
              gen_ai_provider_name: 'anthropic',
              gen_ai_request_model: 'claude-sonnet-4.5',
              gen_ai_token_type: 'input',
            },
            value: [0, '1000'],
          },
        ],
      },
    };

    const cost = calculateTotalCost(response, pricingMap);
    expect(cost.totalCost).toBe(0);
    expect(cost.unresolvedTokens).toBe(1000);
    expect(cost.unresolvedSeries).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
        tokenType: 'input',
        count: 1000,
      },
    ]);
  });

  it('handles cache token types', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: {
              gen_ai_provider_name: 'openai',
              gen_ai_request_model: 'gpt-4o',
              gen_ai_token_type: 'cache_read',
            },
            value: [0, '2000'],
          },
          {
            metric: {
              gen_ai_provider_name: 'openai',
              gen_ai_request_model: 'gpt-4o',
              gen_ai_token_type: 'cache_write',
            },
            value: [0, '1000'],
          },
        ],
      },
    };

    const cost = calculateTotalCost(response, pricingMap);
    expect(cost.totalCost).toBeCloseTo(6.25);
    expect(cost.unresolvedTokens).toBe(0);
  });

  it('returns empty totals for empty vector', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: { resultType: 'vector', result: [] },
    };
    expect(calculateTotalCost(response, pricingMap)).toEqual({
      totalCost: 0,
      unresolvedTokens: 0,
      unresolvedSeries: [],
    });
  });
});

describe('calculateCostTimeSeries', () => {
  const pricingMap = buildPricingMap([
    {
      provider: 'openai',
      model: 'gpt-4o',
      pricing: makePricing({
        prompt_usd_per_token: 0.0025,
        completion_usd_per_token: 0.01,
      }),
    },
  ]);

  it('aggregates cost across series into a single timeseries', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
            values: [
              [1000, '100'],
              [1060, '200'],
            ],
          },
          {
            metric: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'output' },
            values: [
              [1000, '50'],
              [1060, '75'],
            ],
          },
          {
            metric: {
              gen_ai_provider_name: 'anthropic',
              gen_ai_request_model: 'claude-sonnet-4.5',
              gen_ai_token_type: 'input',
            },
            values: [
              [1000, '9999'],
              [1060, '9999'],
            ],
          },
        ],
      },
    };

    const frame = calculateCostTimeSeries(response, pricingMap);
    expect(frame.fields).toHaveLength(2);

    const times = frame.fields[0].values;
    const costs = frame.fields[1].values;

    expect(times).toEqual([1000000, 1060000]);
    expect(costs[0]).toBeCloseTo(0.75);
    expect(costs[1]).toBeCloseTo(1.25);
  });

  it('returns empty frame for non-matrix response', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: { resultType: 'vector', result: [] },
    };
    const frame = calculateCostTimeSeries(response, pricingMap);
    expect(frame.fields).toHaveLength(0);
  });
});
