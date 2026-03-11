import React from 'react';
import { render, screen } from '@testing-library/react';
import RuleTable from './RuleTable';
import type { Evaluator, Rule } from '../../evaluation/types';

describe('RuleTable', () => {
  it('shows the creator in the created column and uses an em dash when empty', () => {
    const rules: Rule[] = [
      {
        rule_id: 'rule.alpha',
        enabled: true,
        selector: 'user_visible_turn',
        match: {},
        sample_rate: 1,
        evaluator_ids: ['eval.alpha'],
        created_by: '',
        updated_by: '',
        created_at: '2026-03-05T09:00:00Z',
        updated_at: '2026-03-05T09:00:00Z',
      },
    ];
    const evaluators: Evaluator[] = [
      {
        evaluator_id: 'eval.alpha',
        version: '2026-03-05',
        kind: 'heuristic',
        config: {},
        output_keys: [{ key: 'heuristic_pass', type: 'bool' }],
        is_predefined: false,
        created_by: 'alex@example.com',
        updated_by: 'alex@example.com',
        created_at: '2026-03-05T09:00:00Z',
        updated_at: '2026-03-05T09:00:00Z',
      },
    ];

    render(<RuleTable rules={rules} evaluators={evaluators} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
