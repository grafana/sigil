import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import HeuristicRuleBuilder from './HeuristicRuleBuilder';
import type { HeuristicQueryGroup } from '../../evaluation/heuristicConfig';
import { HEURISTIC_MAX_NODES } from '../../evaluation/types';

function TestHarness({ initialQuery }: { initialQuery?: HeuristicQueryGroup }) {
  const [query, setQuery] = useState<HeuristicQueryGroup>(
    initialQuery ?? {
      combinator: 'and',
      rules: [{ field: 'response', operator: 'contains', value: 'r' }],
    }
  );

  return <HeuristicRuleBuilder query={query} onChange={setQuery} />;
}

describe('HeuristicRuleBuilder', () => {
  it('keeps focus in text-match inputs while typing', () => {
    render(<TestHarness />);

    let input = screen.getByDisplayValue('r') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 're' } });
    input = screen.getByDisplayValue('re') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'ref' } });
    input = screen.getByDisplayValue('ref') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  it('disables add group when the next child group would exceed max depth', () => {
    render(
      <TestHarness
        initialQuery={{
          combinator: 'and',
          rules: [
            {
              combinator: 'and',
              rules: [
                {
                  combinator: 'and',
                  rules: [{ field: 'response', operator: 'not_empty', value: '' }],
                },
              ],
            },
          ],
        }}
      />
    );

    const addGroupButtons = screen.getAllByRole('button', { name: '+ Group' });
    expect(addGroupButtons.at(-1)).toBeDisabled();
  });

  it('disables add actions when the node cap is reached', () => {
    const rules = Array.from({ length: HEURISTIC_MAX_NODES - 1 }, (_, idx) => ({
      field: 'response' as const,
      operator: 'contains' as const,
      value: `match-${idx}`,
    }));

    render(
      <TestHarness
        initialQuery={{
          combinator: 'and',
          rules,
        }}
      />
    );

    expect(screen.getByRole('button', { name: '+ Rule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Group' })).toBeDisabled();
  });
});
