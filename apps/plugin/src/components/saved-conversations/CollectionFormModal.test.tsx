import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectionFormModal } from './CollectionFormModal';

describe('CollectionFormModal', () => {
  const onSubmit = jest.fn();
  const onClose = jest.fn();

  beforeEach(() => {
    onSubmit.mockReset();
    onClose.mockReset();
  });

  it('renders name and description fields when open', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('disables Create button when name is empty', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('enables Create button when name is non-empty', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My collection' } });
    expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled();
  });

  it('calls onSubmit with name and description on Create click', async () => {
    onSubmit.mockResolvedValue(undefined);
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My collection' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Some notes' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'My collection', description: 'Some notes' }));
  });

  it('calls onClose on Cancel click', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when onSubmit rejects', async () => {
    onSubmit.mockRejectedValue(new Error('server error'));
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Fail' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
