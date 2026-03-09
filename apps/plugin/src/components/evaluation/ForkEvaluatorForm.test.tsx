import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForkEvaluatorForm, { type ForkEvaluatorFormProps } from './ForkEvaluatorForm';

const mockDataSource: ForkEvaluatorFormProps['dataSource'] = {
  listJudgeProviders: async () => new Promise(() => {}),
  listJudgeModels: async () => new Promise(() => {}),
};

describe('ForkEvaluatorForm', () => {
  it('does not call onSubmit when evaluator ID is empty', () => {
    const onSubmit = jest.fn();
    render(
      <ForkEvaluatorForm
        templateID="sigil.helpfulness"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error after attempting to submit with empty ID', () => {
    render(
      <ForkEvaluatorForm
        templateID="sigil.helpfulness"
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(screen.getByText('Evaluator ID is required')).toBeInTheDocument();
  });

  it('calls onSubmit with the entered evaluator ID', () => {
    const onSubmit = jest.fn();
    render(
      <ForkEvaluatorForm
        templateID="sigil.helpfulness"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );
    const input = screen.getByPlaceholderText('sigil.helpfulness');
    fireEvent.change(input, { target: { value: 'my.custom.eval' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ evaluator_id: 'my.custom.eval' }));
  });

  it('does not fall back to templateID when input is empty', () => {
    const onSubmit = jest.fn();
    render(
      <ForkEvaluatorForm
        templateID="sigil.helpfulness"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when only provider override is selected', async () => {
    const onSubmit = jest.fn();
    const resolvedDataSource: ForkEvaluatorFormProps['dataSource'] = {
      listJudgeProviders: jest.fn(async () => ({
        providers: [
          { id: 'openai', name: 'OpenAI', type: 'openai' },
          { id: 'anthropic', name: 'Anthropic', type: 'anthropic' },
        ],
      })),
      listJudgeModels: jest.fn(async () => ({ models: [] })),
    };

    render(
      <ForkEvaluatorForm
        templateID="sigil.helpfulness"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={resolvedDataSource}
      />
    );

    await waitFor(() => expect(resolvedDataSource.listJudgeProviders).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('sigil.helpfulness'), { target: { value: 'my.custom.eval' } });
    fireEvent.mouseDown(screen.getAllByText('Keep template default')[0]);
    fireEvent.click(await screen.findByText('OpenAI'));
    await waitFor(() => expect(resolvedDataSource.listJudgeModels).toHaveBeenCalledWith('openai'));
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose both provider and model, or leave both blank')).toBeInTheDocument();
  });

  it('allows a fully-qualified model override without a provider', () => {
    const onSubmit = jest.fn();
    render(
      <ForkEvaluatorForm
        templateID="sigil.helpfulness"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('sigil.helpfulness'), { target: { value: 'my.custom.eval' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'openai/gpt-4o-mini' } });
    fireEvent.click(screen.getByText('openai/gpt-4o-mini'));
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));

    expect(onSubmit).toHaveBeenCalledWith({
      evaluator_id: 'my.custom.eval',
      config: { model: 'openai/gpt-4o-mini' },
    });
  });

  it('allows provider-only overrides for non-llm_judge forks', async () => {
    const onSubmit = jest.fn();
    const resolvedDataSource: ForkEvaluatorFormProps['dataSource'] = {
      listJudgeProviders: jest.fn(async () => ({
        providers: [{ id: 'openai', name: 'OpenAI', type: 'openai' }],
      })),
      listJudgeModels: jest.fn(async () => ({ models: [] })),
    };

    render(
      <ForkEvaluatorForm
        templateID="sigil.regex"
        kind="regex"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={resolvedDataSource}
      />
    );

    await waitFor(() => expect(resolvedDataSource.listJudgeProviders).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('sigil.regex'), { target: { value: 'my.custom.eval' } });
    fireEvent.mouseDown(screen.getAllByText('Keep template default')[0]);
    fireEvent.click(await screen.findByText('OpenAI'));
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));

    expect(onSubmit).toHaveBeenCalledWith({
      evaluator_id: 'my.custom.eval',
      config: { provider: 'openai' },
    });
  });
});
