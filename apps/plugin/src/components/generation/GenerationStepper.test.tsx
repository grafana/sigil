import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GenerationStepper from './GenerationStepper';
import type { GenerationDetail } from '../../conversation/types';

function makeGenerations(count: number): GenerationDetail[] {
  return Array.from({ length: count }, (_, i) => ({
    generation_id: `gen-${i + 1}`,
    conversation_id: 'conv-1',
  }));
}

describe('GenerationStepper', () => {
  it('shows correct generation label', () => {
    const onSelectIndex = jest.fn();
    render(<GenerationStepper generations={makeGenerations(5)} currentIndex={2} onSelectIndex={onSelectIndex} />);
    expect(screen.getByText('Generation 3 of 5')).toBeInTheDocument();
  });

  it('disables previous button on first generation', () => {
    const onSelectIndex = jest.fn();
    render(<GenerationStepper generations={makeGenerations(3)} currentIndex={0} onSelectIndex={onSelectIndex} />);
    expect(screen.getByLabelText('previous generation')).toBeDisabled();
  });

  it('disables next button on last generation', () => {
    const onSelectIndex = jest.fn();
    render(<GenerationStepper generations={makeGenerations(3)} currentIndex={2} onSelectIndex={onSelectIndex} />);
    expect(screen.getByLabelText('next generation')).toBeDisabled();
  });

  it('calls onSelectIndex with correct index on previous click', () => {
    const onSelectIndex = jest.fn();
    render(<GenerationStepper generations={makeGenerations(3)} currentIndex={1} onSelectIndex={onSelectIndex} />);
    fireEvent.click(screen.getByLabelText('previous generation'));
    expect(onSelectIndex).toHaveBeenCalledWith(0);
  });

  it('calls onSelectIndex with correct index on next click', () => {
    const onSelectIndex = jest.fn();
    render(<GenerationStepper generations={makeGenerations(3)} currentIndex={1} onSelectIndex={onSelectIndex} />);
    fireEvent.click(screen.getByLabelText('next generation'));
    expect(onSelectIndex).toHaveBeenCalledWith(2);
  });

  it('renders nothing when generations is empty', () => {
    const onSelectIndex = jest.fn();
    const { container } = render(<GenerationStepper generations={[]} currentIndex={0} onSelectIndex={onSelectIndex} />);
    expect(container.firstChild).toBeNull();
  });
});
