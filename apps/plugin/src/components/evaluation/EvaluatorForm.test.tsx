import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { Evaluator } from '../../evaluation/types';
import EvaluatorForm from './EvaluatorForm';

const mockDataSource = {
  listJudgeProviders: () => new Promise(() => {}),
  listJudgeModels: () => new Promise(() => {}),
} as unknown as EvaluationDataSource;

describe('EvaluatorForm', () => {
  it('does not leak unrelated config keys when building regex config', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.regex',
      kind: 'regex',
      config: {
        pattern: '^ok$',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'judge this',
        user_prompt: 'score output',
        max_tokens: 256,
        temperature: 0,
      },
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].config).toEqual({ pattern: '^ok$' });
  });
});
