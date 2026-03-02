import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ForkEvaluatorForm from './ForkEvaluatorForm';

describe('ForkEvaluatorForm', () => {
  it('does not call onSubmit when evaluator ID is empty', () => {
    const onSubmit = jest.fn();
    render(<ForkEvaluatorForm templateID="sigil.helpfulness" onSubmit={onSubmit} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error after attempting to submit with empty ID', () => {
    render(<ForkEvaluatorForm templateID="sigil.helpfulness" onSubmit={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(screen.getByText('Evaluator ID is required')).toBeInTheDocument();
  });

  it('calls onSubmit with the entered evaluator ID', () => {
    const onSubmit = jest.fn();
    render(<ForkEvaluatorForm templateID="sigil.helpfulness" onSubmit={onSubmit} onCancel={jest.fn()} />);
    const input = screen.getByPlaceholderText('sigil.helpfulness');
    fireEvent.change(input, { target: { value: 'my.custom.eval' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ evaluator_id: 'my.custom.eval' }));
  });

  it('does not fall back to templateID when input is empty', () => {
    const onSubmit = jest.fn();
    render(<ForkEvaluatorForm templateID="sigil.helpfulness" onSubmit={onSubmit} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
