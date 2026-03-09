import {
  createDefaultHeuristicConfig,
  createDefaultHeuristicQuery,
  formatHeuristicNodeSummary,
  heuristicQueryToConfig,
  normalizeHeuristicConfig,
  validateHeuristicQuery,
} from './heuristicConfig';

describe('heuristicConfig', () => {
  it('normalizes a nested heuristic v2 config', () => {
    expect(
      normalizeHeuristicConfig({
        version: 'v2',
        root: {
          kind: 'group',
          operator: 'and',
          rules: [
            { kind: 'rule', type: 'not_empty' },
            {
              kind: 'group',
              operator: 'or',
              rules: [
                { kind: 'rule', type: 'contains', value: 'refund' },
                { kind: 'rule', type: 'contains', value: 'return' },
              ],
            },
          ],
        },
      })
    ).toEqual({
      version: 'v2',
      root: {
        kind: 'group',
        operator: 'and',
        rules: [
          { kind: 'rule', type: 'not_empty' },
          {
            kind: 'group',
            operator: 'or',
            rules: [
              { kind: 'rule', type: 'contains', value: 'refund' },
              { kind: 'rule', type: 'contains', value: 'return' },
            ],
          },
        ],
      },
    });
  });

  it('serializes editor state back to the API config shape', () => {
    const query = createDefaultHeuristicQuery(createDefaultHeuristicConfig());
    expect(heuristicQueryToConfig(query)).toEqual(createDefaultHeuristicConfig());
  });

  it('validates missing rule values', () => {
    const query = createDefaultHeuristicQuery({
      version: 'v2',
      root: {
        kind: 'group',
        operator: 'and',
        rules: [{ kind: 'rule', type: 'contains', value: 'refund' }],
      },
    });

    query.rules = [{ ...query.rules[0], value: '' }];

    expect(validateHeuristicQuery(query)).toBe('Text match rules need a value');
  });

  it('rejects fractional and exponent length values', () => {
    const query = createDefaultHeuristicQuery({
      version: 'v2',
      root: {
        kind: 'group',
        operator: 'and',
        rules: [{ kind: 'rule', type: 'min_length', value: 1 }],
      },
    });

    query.rules = [{ ...query.rules[0], value: '1.5' }];
    expect(validateHeuristicQuery(query)).toBe('Length rules need a non-negative value');

    query.rules = [{ ...query.rules[0], value: '2e3' }];
    expect(validateHeuristicQuery(query)).toBe('Length rules need a non-negative value');
  });

  it('formats a readable nested summary', () => {
    expect(
      formatHeuristicNodeSummary({
        kind: 'group',
        operator: 'and',
        rules: [
          { kind: 'rule', type: 'not_empty' },
          {
            kind: 'group',
            operator: 'or',
            rules: [
              { kind: 'rule', type: 'contains', value: 'refund' },
              { kind: 'rule', type: 'contains', value: 'return' },
            ],
          },
        ],
      })
    ).toBe('all of: response is not empty; any of: contains "refund"; contains "return"');
  });
});
