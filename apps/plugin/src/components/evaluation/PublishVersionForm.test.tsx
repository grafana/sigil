import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EvaluationDataSource } from '../../evaluation/api';
import PublishVersionForm from './PublishVersionForm';

const mockDataSource = {
  listJudgeProviders: () => new Promise(() => {}),
  listJudgeModels: () => new Promise(() => {}),
} as unknown as EvaluationDataSource;

describe('PublishVersionForm', () => {
  it('blocks submit when only provider is selected for llm_judge', () => {
    const onSubmit = jest.fn();

    render(
      <PublishVersionForm
        kind="llm_judge"
        initialConfig={{ provider: 'openai', max_tokens: 128, temperature: 0 }}
        initialOutputKeys={[{ key: 'score', type: 'number' }]}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose both provider and model, or leave both blank')).toBeInTheDocument();
  });

  it('forces regex outputs to bool and strips unsupported pass configuration', () => {
    const onSubmit = jest.fn();

    render(
      <PublishVersionForm
        kind="regex"
        initialConfig={{ pattern: '^ok$' }}
        initialOutputKeys={[{ key: 'regex_match', type: 'string', pass_match: ['ok'] }]}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );

    expect(screen.getByDisplayValue('bool')).toBeDisabled();
    expect(screen.queryByText('Pass values')).not.toBeInTheDocument();
    expect(screen.queryByText('Pass when')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].output_keys).toEqual([{ key: 'regex_match', type: 'bool' }]);
  });
});
