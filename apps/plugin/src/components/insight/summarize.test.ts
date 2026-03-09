import type { PrometheusQueryResponse } from '../../dashboard/types';
import {
  summarizeVector,
  summarizeMatrix,
  hasResponseData,
  compactNumber,
  findSharedLabelKey,
  formatMetricLabels,
} from './summarize';

function vectorResponse(
  results: Array<{ metric: Record<string, string>; value: [number, string] }>
): PrometheusQueryResponse {
  return { status: 'success', data: { resultType: 'vector', result: results } };
}

function matrixResponse(
  results: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>
): PrometheusQueryResponse {
  return { status: 'success', data: { resultType: 'matrix', result: results } };
}

describe('compactNumber', () => {
  it('returns 0 for zero', () => {
    expect(compactNumber(0)).toBe('0');
  });

  it('rounds large numbers to integers', () => {
    expect(compactNumber(5432399.73)).toBe('5432400');
    expect(compactNumber(12991.26)).toBe('12991');
  });

  it('uses 3 decimal places for mid-range', () => {
    expect(compactNumber(86.0671)).toBe('86.067');
    expect(compactNumber(1.1791)).toBe('1.179');
    expect(compactNumber(4.7588)).toBe('4.759');
  });

  it('uses 6 decimal places for small numbers', () => {
    expect(compactNumber(0.009524)).toBe('0.009524');
    expect(compactNumber(0.0571)).toBe('0.0571');
  });

  it('strips trailing zeros', () => {
    expect(compactNumber(10)).toBe('10');
    expect(compactNumber(1.1)).toBe('1.1');
    expect(compactNumber(0.009)).toBe('0.009');
  });
});

describe('findSharedLabelKey', () => {
  it('returns the key when all series share a single label key', () => {
    const results = [
      { metric: { gen_ai_agent_name: 'assistant' } },
      { metric: { gen_ai_agent_name: 'summarizer' } },
      { metric: { gen_ai_agent_name: 'judge' } },
    ];
    expect(findSharedLabelKey(results)).toBe('gen_ai_agent_name');
  });

  it('returns null when series have different label keys', () => {
    const results: Array<{ metric: Record<string, string> }> = [
      { metric: { model: 'gpt-4' } },
      { metric: { provider: 'openai' } },
    ];
    expect(findSharedLabelKey(results)).toBeNull();
  });

  it('returns null when any series has multiple label keys', () => {
    const results: Array<{ metric: Record<string, string> }> = [
      { metric: { model: 'gpt-4', provider: 'openai' } },
      { metric: { model: 'claude' } },
    ];
    expect(findSharedLabelKey(results)).toBeNull();
  });

  it('returns null for empty results', () => {
    expect(findSharedLabelKey([])).toBeNull();
  });

  it('returns the key for a single series', () => {
    expect(findSharedLabelKey([{ metric: { agent: 'bot' } }])).toBe('agent');
  });

  it('ignores __ prefixed keys', () => {
    const results = [{ metric: { __name__: 'metric', agent: 'a' } }, { metric: { __name__: 'metric', agent: 'b' } }];
    expect(findSharedLabelKey(results)).toBe('agent');
  });

  it('returns null when metric has only __ keys', () => {
    const results = [{ metric: { __name__: 'metric' } }, { metric: { __name__: 'metric' } }];
    expect(findSharedLabelKey(results)).toBeNull();
  });
});

describe('formatMetricLabels', () => {
  it('returns just the value when sharedKey matches the only label', () => {
    expect(formatMetricLabels({ gen_ai_agent_name: 'assistant' }, 'gen_ai_agent_name')).toBe('assistant');
  });

  it('returns key=value when sharedKey is null', () => {
    expect(formatMetricLabels({ model: 'gpt-4' }, null)).toBe('model=gpt-4');
  });

  it('returns key=value pairs when sharedKey does not match', () => {
    expect(formatMetricLabels({ provider: 'openai' }, 'model')).toBe('provider=openai');
  });

  it('returns "total" for empty metric', () => {
    expect(formatMetricLabels({}, null)).toBe('total');
    expect(formatMetricLabels({}, 'agent')).toBe('total');
  });

  it('joins multiple labels with comma', () => {
    expect(formatMetricLabels({ model: 'gpt-4', provider: 'openai' }, null)).toBe('model=gpt-4, provider=openai');
  });

  it('falls back to key=value when metric has multiple keys even if sharedKey matches one', () => {
    expect(formatMetricLabels({ model: 'gpt-4', provider: 'openai' }, 'model')).toBe('model=gpt-4, provider=openai');
  });

  it('ignores __ prefixed keys', () => {
    expect(formatMetricLabels({ __name__: 'metric', agent: 'bot' }, 'agent')).toBe('bot');
    expect(formatMetricLabels({ __name__: 'metric', agent: 'bot' }, null)).toBe('agent=bot');
  });
});

describe('hasResponseData', () => {
  it('returns false for null', () => {
    expect(hasResponseData(null)).toBe(false);
  });

  it('returns false for empty vector', () => {
    expect(hasResponseData(vectorResponse([]))).toBe(false);
  });

  it('returns true for non-empty vector', () => {
    expect(hasResponseData(vectorResponse([{ metric: {}, value: [1, '42'] }]))).toBe(true);
  });
});

describe('summarizeVector', () => {
  it('returns no data for null response', () => {
    expect(summarizeVector(null, 'Latency')).toBe('Latency: no data');
  });

  it('returns 0 for empty results', () => {
    expect(summarizeVector(vectorResponse([]), 'Latency')).toBe('Latency: 0');
  });

  it('returns compact value for single result', () => {
    const resp = vectorResponse([{ metric: {}, value: [1, '23.5'] }]);
    expect(summarizeVector(resp, 'Latency P95')).toBe('Latency P95: 23.5');
  });

  it('replaces NaN with "no data" for single result', () => {
    const resp = vectorResponse([{ metric: {}, value: [1, 'NaN'] }]);
    expect(summarizeVector(resp, 'Latency P95')).toBe('Latency P95: no data');
  });

  it('replaces +Inf with "no data" for single result', () => {
    const resp = vectorResponse([{ metric: {}, value: [1, '+Inf'] }]);
    expect(summarizeVector(resp, 'Latency')).toBe('Latency: no data');
  });

  it('strips shared label key and keeps only values', () => {
    const resp = vectorResponse([
      { metric: { model: 'gpt-4' }, value: [1, '12.3'] },
      { metric: { model: 'claude' }, value: [1, '5.7'] },
    ]);
    const result = summarizeVector(resp, 'Latency');
    expect(result).toContain('gpt-4: 12.3');
    expect(result).toContain('claude: 5.7');
    expect(result).not.toContain('model=');
  });

  it('keeps key=value when series have different label keys', () => {
    const resp = vectorResponse([
      { metric: { model: 'gpt-4' }, value: [1, '12.3'] },
      { metric: { provider: 'openai' }, value: [1, '5.7'] },
    ]);
    const result = summarizeVector(resp, 'Latency');
    expect(result).toContain('model=gpt-4: 12.3');
    expect(result).toContain('provider=openai: 5.7');
  });

  it('formats NaN entries alongside valid ones', () => {
    const resp = vectorResponse([
      { metric: { model: 'gpt-4' }, value: [1, '12.3'] },
      { metric: { model: 'claude' }, value: [1, 'NaN'] },
    ]);
    const result = summarizeVector(resp, 'Latency');
    expect(result).toContain('gpt-4: 12.3');
    expect(result).toContain('claude: no data');
    expect(result).not.toContain('NaN');
  });

  it('filters zero-value entries and reports count', () => {
    const resp = vectorResponse([
      { metric: { agent: 'assistant' }, value: [1, '3255329'] },
      { metric: { agent: 'inactive-1' }, value: [1, '0'] },
      { metric: { agent: 'inactive-2' }, value: [1, '0'] },
      { metric: { agent: 'inactive-3' }, value: [1, '0'] },
    ]);
    const result = summarizeVector(resp, 'Total tokens');
    expect(result).toContain('assistant: 3255329');
    expect(result).not.toContain('inactive-1');
    expect(result).toContain('(3 others: 0)');
  });

  it('handles all-zero vector series', () => {
    const resp = vectorResponse([
      { metric: { agent: 'a' }, value: [1, '0'] },
      { metric: { agent: 'b' }, value: [1, '0'] },
    ]);
    expect(summarizeVector(resp, 'Tokens')).toBe('Tokens: all 2 series are 0');
  });

  it('compacts large float values', () => {
    const resp = vectorResponse([{ metric: {}, value: [1, '86.06710284812847'] }]);
    expect(summarizeVector(resp, 'Requests')).toBe('Requests: 86.067');
  });

  it('compacts small float in single-result vector', () => {
    const resp = vectorResponse([{ metric: {}, value: [1, '0.009523809523809523'] }]);
    expect(summarizeVector(resp, 'Rate')).toBe('Rate: 0.009524');
  });
});

describe('summarizeMatrix', () => {
  it('returns no data for null response', () => {
    expect(summarizeMatrix(null, 'Latency')).toBe('Latency: no data');
  });

  it('returns no series for empty results', () => {
    expect(summarizeMatrix(matrixResponse([]), 'Latency')).toBe('Latency: no series');
  });

  it('silently skips NaN points and uses first/last valid values', () => {
    const resp = matrixResponse([
      {
        metric: {},
        values: [
          [1, 'NaN'],
          [2, 'NaN'],
          [3, '10.5'],
          [4, '23.5'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency over time');
    expect(result).toContain('first=10.5');
    expect(result).toContain('last=23.5');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('points=');
  });

  it('omits series entirely when all points are NaN', () => {
    const resp = matrixResponse([
      {
        metric: { model: 'gpt-4' },
        values: [
          [1, 'NaN'],
          [2, 'NaN'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency');
    expect(result).toBe('Latency: no data');
    expect(result).not.toContain('NaN');
  });

  it('omits all-NaN series but keeps valid ones', () => {
    const resp = matrixResponse([
      {
        metric: { model: 'gpt-4' },
        values: [
          [1, 'NaN'],
          [2, 'NaN'],
        ],
      },
      {
        metric: { model: 'claude' },
        values: [
          [1, '5'],
          [2, '10'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency');
    expect(result).toContain('claude');
    expect(result).not.toContain('gpt-4');
    expect(result).toContain('1 series');
    expect(result).not.toContain('NaN');
  });

  it('includes min/max/avg with compact numbers', () => {
    const resp = matrixResponse([
      {
        metric: {},
        values: [
          [1, '10'],
          [2, '20'],
          [3, '30'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency');
    expect(result).toContain('min=10');
    expect(result).toContain('max=30');
    expect(result).toContain('avg=20');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('points=');
  });

  it('does not mention NaN when no NaN points exist', () => {
    const resp = matrixResponse([
      {
        metric: {},
        values: [
          [1, '5'],
          [2, '10'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency');
    expect(result).not.toContain('NaN');
  });

  it('filters all-zero series and reports count', () => {
    const resp = matrixResponse([
      {
        metric: { agent: 'active' },
        values: [
          [1, '5'],
          [2, '10'],
        ],
      },
      {
        metric: { agent: 'idle-1' },
        values: [
          [1, '0'],
          [2, '0'],
        ],
      },
      {
        metric: { agent: 'idle-2' },
        values: [
          [1, '0'],
          [2, '0'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Requests over time');
    expect(result).toContain('active:');
    expect(result).not.toContain('idle-1');
    expect(result).not.toContain('idle-2');
    expect(result).toContain('(2 others: all zeros)');
    expect(result).toContain('1 series');
  });

  it('reports all-zero when every series is zero', () => {
    const resp = matrixResponse([
      {
        metric: { agent: 'a' },
        values: [
          [1, '0'],
          [2, '0'],
        ],
      },
      {
        metric: { agent: 'b' },
        values: [
          [1, '0'],
          [2, '0'],
        ],
      },
    ]);
    expect(summarizeMatrix(resp, 'Requests')).toBe('Requests: all 2 series are 0');
  });

  it('compresses constant (flat) series', () => {
    const resp = matrixResponse([
      {
        metric: { agent: 'metadata-gen' },
        values: [
          [1, '4.75'],
          [2, '4.75'],
          [3, '4.75'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency');
    expect(result).toContain('constant=4.75');
    expect(result).not.toContain('first=');
    expect(result).not.toContain('last=');
  });

  it('strips shared label key in matrix output', () => {
    const resp = matrixResponse([
      {
        metric: { gen_ai_agent_name: 'assistant' },
        values: [
          [1, '5'],
          [2, '10'],
        ],
      },
      {
        metric: { gen_ai_agent_name: 'summarizer' },
        values: [
          [1, '3'],
          [2, '7'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Latency');
    expect(result).toContain('assistant:');
    expect(result).toContain('summarizer:');
    expect(result).not.toContain('gen_ai_agent_name=');
  });

  it('compacts decimal precision in matrix stats', () => {
    const resp = matrixResponse([
      {
        metric: {},
        values: [
          [1, '0.009523809523809523'],
          [2, '0.057142857142857134'],
        ],
      },
    ]);
    const result = summarizeMatrix(resp, 'Requests over time');
    expect(result).toContain('first=0.009524');
    expect(result).toContain('last=0.057143');
    expect(result).not.toContain('0.009523809523809523');
  });
});
