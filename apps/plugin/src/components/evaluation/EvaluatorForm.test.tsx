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

  it('does not show a version field', () => {
    render(<EvaluatorForm onSubmit={jest.fn()} onCancel={jest.fn()} dataSource={mockDataSource} />);

    expect(screen.queryByLabelText('Version')).not.toBeInTheDocument();
  });

  it('blocks submit when max tokens is not greater than zero', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.judge',
      kind: 'llm_judge',
      config: {
        system_prompt: 'judge this',
        user_prompt: 'score output',
        max_tokens: 0,
        temperature: 0,
      },
      output_keys: [{ key: 'score', type: 'number' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Must be an integer greater than 0')).toBeInTheDocument();
  });

  it('blocks submit when schema JSON is invalid', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.schema',
      kind: 'json_schema',
      config: {
        schema: { type: 'object' },
      },
      output_keys: [{ key: 'score', type: 'bool' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.change(screen.getByPlaceholderText('{"type": "object", "properties": {...}}'), {
      target: { value: '{"type":' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
  });

  it('blocks submit when heuristic max length is less than min length', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.heuristic',
      kind: 'heuristic',
      config: {
        min_length: 20,
        max_length: 5,
      },
      output_keys: [{ key: 'passed', type: 'bool' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Must be greater than or equal to Min length')).toBeInTheDocument();
  });

  it('does not use em-dash placeholders for numeric score pass conditions', () => {
    render(<EvaluatorForm onSubmit={jest.fn()} onCancel={jest.fn()} dataSource={mockDataSource} />);

    expect(screen.queryByPlaceholderText('—')).not.toBeInTheDocument();
  });
});
