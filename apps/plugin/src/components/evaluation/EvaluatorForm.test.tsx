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

  it('focuses the first invalid field on submit', () => {
    render(<EvaluatorForm onSubmit={jest.fn()} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByPlaceholderText('e.g. custom.helpfulness')).toHaveFocus();
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

  it('blocks submit when temperature is greater than two', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.temperature',
      kind: 'llm_judge',
      config: {
        system_prompt: 'judge this',
        user_prompt: 'score output',
        max_tokens: 128,
        temperature: 2.5,
      },
      output_keys: [{ key: 'score', type: 'number' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Must be between 0 and 2')).toBeInTheDocument();
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

  it('blocks submit when pass threshold is lower than min', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.threshold',
      kind: 'llm_judge',
      config: {
        system_prompt: 'judge this',
        user_prompt: 'score output',
        max_tokens: 128,
        temperature: 0,
      },
      output_keys: [{ key: 'score', type: 'number', pass_threshold: 0, min: 1, max: 10 }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Must be greater than or equal to Min')).toBeInTheDocument();
  });

  it('blocks submit when max is not greater than min', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.range',
      kind: 'llm_judge',
      config: {
        system_prompt: 'judge this',
        user_prompt: 'score output',
        max_tokens: 128,
        temperature: 0,
      },
      output_keys: [{ key: 'score', type: 'number', pass_threshold: 5, min: 1, max: 1 }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Must be greater than Min')).toBeInTheDocument();
  });

  it('blocks submit when heuristic max length is not greater than min length', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.heuristic',
      kind: 'heuristic',
      config: {
        min_length: 20,
        max_length: 20,
      },
      output_keys: [{ key: 'passed', type: 'bool' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Must be greater than Min length')).toBeInTheDocument();
  });

  it('blocks submit when heuristic has no rules', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.heuristic.empty',
      kind: 'heuristic',
      config: {},
      output_keys: [{ key: 'passed', type: 'bool' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Add at least one heuristic rule')).toBeInTheDocument();
  });

  it('preserves heuristic contains rules when submitting', () => {
    const onSubmit = jest.fn();
    const prefill: Partial<Evaluator> = {
      evaluator_id: 'seed.heuristic.contains',
      kind: 'heuristic',
      config: {
        not_empty: true,
        contains: ['refund requested', 'account issue'],
        not_contains: ['profanity'],
        min_length: 1,
        max_length: 100,
      },
      output_keys: [{ key: 'passed', type: 'bool' }],
    };

    render(<EvaluatorForm prefill={prefill} onSubmit={onSubmit} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].config).toEqual({
      not_empty: true,
      contains: ['refund requested', 'account issue'],
      not_contains: ['profanity'],
      min_length: 1,
      max_length: 100,
    });
  });

  it('does not use em-dash placeholders for numeric score pass conditions', () => {
    render(<EvaluatorForm onSubmit={jest.fn()} onCancel={jest.fn()} dataSource={mockDataSource} />);

    expect(screen.queryByPlaceholderText('—')).not.toBeInTheDocument();
  });
});
