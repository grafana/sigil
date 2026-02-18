import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ThinkingBlock from './ThinkingBlock';

describe('ThinkingBlock', () => {
  it('renders collapsed by default with label', () => {
    render(<ThinkingBlock content="Deep thoughts..." />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.queryByText('Deep thoughts...')).not.toBeInTheDocument();
  });

  it('expands to show content on click', () => {
    render(<ThinkingBlock content="Deep thoughts..." />);
    fireEvent.click(screen.getByLabelText('toggle thinking'));
    expect(screen.getByText('Deep thoughts...')).toBeInTheDocument();
  });

  it('collapses again on second click', () => {
    render(<ThinkingBlock content="Deep thoughts..." />);
    fireEvent.click(screen.getByLabelText('toggle thinking'));
    expect(screen.getByText('Deep thoughts...')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('toggle thinking'));
    expect(screen.queryByText('Deep thoughts...')).not.toBeInTheDocument();
  });
});
