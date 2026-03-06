import { formatHeuristicStringList, parseHeuristicStringListInput } from './heuristicConfig';

describe('heuristicConfig', () => {
  it('preserves commas inside a single heuristic phrase', () => {
    expect(parseHeuristicStringListInput("sorry, can't help")).toEqual(["sorry, can't help"]);
  });

  it('splits textarea input on newlines only', () => {
    expect(parseHeuristicStringListInput('refund requested, pending review\naccount issue')).toEqual([
      'refund requested, pending review',
      'account issue',
    ]);
  });

  it('formats heuristic values one phrase per line', () => {
    expect(formatHeuristicStringList(['refund requested, pending review', 'account issue'])).toBe(
      'refund requested, pending review\naccount issue'
    );
  });
});
