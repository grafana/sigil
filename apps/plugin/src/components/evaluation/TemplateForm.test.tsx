import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EvaluationDataSource } from '../../evaluation/api';
import TemplateForm from './TemplateForm';

const mockDataSource = {
  listJudgeProviders: () => new Promise(() => {}),
  listJudgeModels: () => new Promise(() => {}),
} as unknown as EvaluationDataSource;

describe('TemplateForm', () => {
  it('blocks submit when only provider is selected for llm_judge', async () => {
    const onSubmit = jest.fn();
    const resolvedDataSource = {
      listJudgeProviders: jest.fn(async () => ({
        providers: [{ id: 'openai', name: 'OpenAI', type: 'openai' }],
      })),
      listJudgeModels: jest.fn(async () => ({ models: [] })),
    } as unknown as EvaluationDataSource;

    render(<TemplateForm onSubmit={onSubmit} onCancel={jest.fn()} dataSource={resolvedDataSource} />);

    await waitFor(() => expect(resolvedDataSource.listJudgeProviders).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('e.g. my_org.helpfulness'), {
      target: { value: 'sigil.provider-only' },
    });
    fireEvent.mouseDown(screen.getAllByText('Default')[0]);
    fireEvent.click(await screen.findByText('OpenAI'));
    await waitFor(() => expect(resolvedDataSource.listJudgeModels).toHaveBeenCalledWith('openai'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose both provider and model, or leave both blank')).toBeInTheDocument();
  });

  it('does not throw when schema JSON is invalid while emitting config changes', async () => {
    const onConfigChange = jest.fn();

    render(
      <TemplateForm
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        onConfigChange={onConfigChange}
        dataSource={mockDataSource}
      />
    );

    fireEvent.mouseDown(screen.getByText('LLM Judge'));
    fireEvent.click(await screen.findByText('JSON Schema'));

    const schemaField = await screen.findByPlaceholderText('{"type": "object", "properties": {...}}');
    fireEvent.change(schemaField, { target: { value: '{"type":' } });

    await waitFor(() => {
      expect(onConfigChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: 'json_schema',
          config: { schema: {} },
        })
      );
    });
  });

  it('shows json_schema as a fixed bool output kind', async () => {
    render(<TemplateForm onSubmit={jest.fn()} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.mouseDown(screen.getByText('LLM Judge'));
    fireEvent.click(await screen.findByText('JSON Schema'));

    expect(screen.getByDisplayValue('json_valid')).toBeInTheDocument();
    expect(screen.getByDisplayValue('bool')).toBeDisabled();
    expect(screen.queryByText('Pass threshold')).not.toBeInTheDocument();
    expect(screen.queryByText('Pass when')).not.toBeInTheDocument();
    expect(screen.getByText(/built-in JSON Schema subset/i)).toBeInTheDocument();
  });

  it('preserves a custom output key when switching kinds', async () => {
    render(<TemplateForm onSubmit={jest.fn()} onCancel={jest.fn()} dataSource={mockDataSource} />);

    fireEvent.change(screen.getByPlaceholderText('score'), { target: { value: 'custom_key' } });
    fireEvent.mouseDown(screen.getByText('LLM Judge'));
    fireEvent.click(await screen.findByText('Regex'));

    expect(screen.getByDisplayValue('custom_key')).toBeInTheDocument();
  });
});
