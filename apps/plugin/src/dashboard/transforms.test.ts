import {
  matrixToDataFrames,
  vectorToDataFrame,
  vectorToPieDataFrame,
  vectorToStatValue,
  statValueToDataFrame,
} from './transforms';
import type { PrometheusQueryResponse } from './types';

describe('matrixToDataFrames', () => {
  it('converts matrix response to data frames', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { gen_ai_token_type: 'input' },
            values: [
              [1700000000, '100'],
              [1700000060, '150'],
            ],
          },
          {
            metric: { gen_ai_token_type: 'output' },
            values: [
              [1700000000, '50'],
              [1700000060, '75'],
            ],
          },
        ],
      },
    };

    const frames = matrixToDataFrames(response);
    expect(frames).toHaveLength(2);

    expect(frames[0].name).toBe('input');
    expect(frames[0].fields[0].values).toEqual([1700000000000, 1700000060000]);
    expect(frames[0].fields[1].values).toEqual([100, 150]);

    expect(frames[1].name).toBe('output');
    expect(frames[1].fields[1].values).toEqual([50, 75]);
  });

  it('returns empty array for non-matrix response', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: { resultType: 'vector', result: [] },
    };
    expect(matrixToDataFrames(response)).toEqual([]);
  });
});

describe('vectorToDataFrame', () => {
  it('converts vector response to data frame', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { gen_ai_provider_name: 'openai' }, value: [1700000000, '500'] },
          { metric: { gen_ai_provider_name: 'anthropic' }, value: [1700000000, '300'] },
        ],
      },
    };

    const frame = vectorToDataFrame(response, 'Calls');
    expect(frame.fields).toHaveLength(2);
    expect(frame.fields[0].values).toEqual(['openai', 'anthropic']);
    expect(frame.fields[1].values).toEqual([500, 300]);
    expect(frame.fields[1].name).toBe('Calls');
  });

  it('returns empty frame for non-vector response', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: { resultType: 'matrix', result: [] },
    };
    const frame = vectorToDataFrame(response);
    expect(frame.fields).toHaveLength(0);
  });

  it('prefers gen_ai token type and avoids duplicated legend values', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: {
              __name__: 'gen_ai_client_token_usage_sum',
              gen_ai_token_type: 'input',
              gen_ai_provider_name: 'input',
              gen_ai_request_model: 'input',
            },
            value: [1700000000, '10'],
          },
        ],
      },
    };

    const frame = vectorToDataFrame(response);
    expect(frame.fields[0].values).toEqual(['input']);
  });
});

describe('vectorToPieDataFrame', () => {
  it('creates one numeric field per vector series', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { gen_ai_provider_name: 'openai' }, value: [1700000000, '500'] },
          { metric: { gen_ai_provider_name: 'anthropic' }, value: [1700000000, '300'] },
        ],
      },
    };

    const frame = vectorToPieDataFrame(response, ['gen_ai_provider_name']);
    expect(frame.fields).toHaveLength(2);
    expect(frame.fields[0].name).toBe('anthropic');
    expect(frame.fields[0].values).toEqual([300]);
    expect(frame.fields[1].name).toBe('openai');
    expect(frame.fields[1].values).toEqual([500]);
  });

  it('builds provider/model labels when both keys are requested', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-5' },
            value: [1700000000, '42'],
          },
        ],
      },
    };

    const frame = vectorToPieDataFrame(response, ['gen_ai_provider_name', 'gen_ai_request_model'], '/');
    expect(frame.fields).toHaveLength(1);
    expect(frame.fields[0].name).toBe('openai/gpt-5');
    expect(frame.fields[0].values).toEqual([42]);
  });
});

describe('vectorToStatValue', () => {
  it('extracts first value from vector', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [{ metric: {}, value: [1700000000, '42.5'] }],
      },
    };
    expect(vectorToStatValue(response)).toBe(42.5);
  });

  it('returns 0 for empty vector', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: { resultType: 'vector', result: [] },
    };
    expect(vectorToStatValue(response)).toBe(0);
  });

  it('returns 0 for non-vector response', () => {
    const response: PrometheusQueryResponse = {
      status: 'success',
      data: { resultType: 'matrix', result: [] },
    };
    expect(vectorToStatValue(response)).toBe(0);
  });
});

describe('statValueToDataFrame', () => {
  it('creates a stat-compatible frame', () => {
    const frame = statValueToDataFrame(42, 'Total');
    expect(frame.fields).toHaveLength(1);
    expect(frame.fields[0].name).toBe('Total');
    expect(frame.fields[0].values).toEqual([42]);
  });

  it('applies unit config', () => {
    const frame = statValueToDataFrame(9.99, 'Cost', 'currencyUSD');
    expect(frame.fields[0].config).toEqual({ unit: 'currencyUSD' });
  });
});
