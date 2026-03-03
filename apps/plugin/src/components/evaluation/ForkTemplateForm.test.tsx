import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ForkTemplateForm, { type ForkTemplateFormProps } from './ForkTemplateForm';

const mockDataSource: ForkTemplateFormProps['dataSource'] = {
  listJudgeProviders: jest.fn(async () => ({ providers: [] })),
  listJudgeModels: jest.fn(async () => ({ models: [] })),
};

describe('ForkTemplateForm', () => {
  it('submits evaluator ID using shared fork form behavior', async () => {
    const onSubmit = jest.fn();
    render(
      <ForkTemplateForm
        templateID="sigil.helpfulness"
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        dataSource={mockDataSource}
      />
    );

    await waitFor(() => expect(mockDataSource.listJudgeProviders).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('sigil.helpfulness'), { target: { value: 'my.forked.eval' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fork to Evaluator' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ evaluator_id: 'my.forked.eval' }));
  });
});
