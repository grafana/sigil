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
});
