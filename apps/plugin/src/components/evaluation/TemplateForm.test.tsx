import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EvaluationDataSource } from '../../evaluation/api';
import TemplateForm from './TemplateForm';

const mockDataSource = {
  listJudgeProviders: () => new Promise(() => {}),
  listJudgeModels: () => new Promise(() => {}),
} as unknown as EvaluationDataSource;

describe('TemplateForm', () => {
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
});
