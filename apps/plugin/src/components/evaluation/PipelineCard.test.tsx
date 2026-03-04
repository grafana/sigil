import React from 'react';
import { render, screen } from '@testing-library/react';
import PipelineCard from './PipelineCard';
import type { Evaluator, Rule } from '../../evaluation/types';

const mockRule: Rule = {
  rule_id: 'test-rule',
  enabled: true,
  selector: 'user_visible_turn',
  match: {},
  sample_rate: 0.5,
  evaluator_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockEvaluators: Evaluator[] = [];

describe('PipelineCard', () => {
  it('renders rule id and pipeline steps', () => {
    render(<PipelineCard rule={mockRule} evaluators={mockEvaluators} />);
    expect(screen.getByText('test-rule')).toBeInTheDocument();
  });

  it('renders sample rate label', () => {
    render(<PipelineCard rule={mockRule} evaluators={mockEvaluators} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});
