import type { PrometheusQueryResponse } from '../../dashboard/types';
import { summarizeVector, summarizeMatrix, hasResponseData } from './summarize';

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

  it('returns value for single result', () => {
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

  it('formats multiple results with tags and replaces NaN values', () => {
    const resp = vectorResponse([
      { metric: { model: 'gpt-4' }, value: [1, '12.3'] },
      { metric: { model: 'claude' }, value: [1, 'NaN'] },
    ]);
    const result = summarizeVector(resp, 'Latency');
    expect(result).toContain('model=gpt-4: 12.3');
    expect(result).toContain('model=claude: no data');
    expect(result).not.toContain('NaN');
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
    expect(result).toContain('points=2');
    expect(result).not.toContain('NaN');
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
    expect(result).toContain('model=claude');
    expect(result).not.toContain('model=gpt-4');
    expect(result).toContain('1 series');
    expect(result).not.toContain('NaN');
  });

  it('includes min/max/avg for valid data', () => {
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
    expect(result).toContain('avg=20.0000');
    expect(result).not.toContain('NaN');
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
    expect(result).toContain('points=2');
  });
});
