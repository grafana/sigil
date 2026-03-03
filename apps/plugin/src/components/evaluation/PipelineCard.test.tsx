import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('shows a delete button with trash icon instead of a menu icon', () => {
    render(<PipelineCard rule={mockRule} evaluators={mockEvaluators} onDelete={jest.fn()} />);
    const btn = screen.getByRole('button', { name: 'Delete rule' });
    expect(btn).toBeInTheDocument();
  });

  it('prompts for confirmation before calling onDelete', () => {
    const onDelete = jest.fn();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PipelineCard rule={mockRule} evaluators={mockEvaluators} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith('test-rule');
  });

  it('does not call onDelete when confirmation is cancelled', () => {
    const onDelete = jest.fn();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PipelineCard rule={mockRule} evaluators={mockEvaluators} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
