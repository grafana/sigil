import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import HeuristicRuleBuilder from './HeuristicRuleBuilder';
import type { HeuristicQueryGroup } from '../../evaluation/heuristicConfig';

function TestHarness() {
  const [query, setQuery] = useState<HeuristicQueryGroup>({
    combinator: 'and',
    rules: [{ field: 'response', operator: 'contains', value: 'r' }],
  });

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
});
