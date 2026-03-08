import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PromptTemplateTextarea from './PromptTemplateTextarea';

describe('PromptTemplateTextarea', () => {
  it('keeps textarea and overlay box models aligned', () => {
    const { container } = render(
      <PromptTemplateTextarea
        value={'System instructions\n{{input}}'}
        onChange={jest.fn()}
        placeholder="Type a prompt"
      />
    );

    const textarea = screen.getByRole('textbox');
    const wrapper = container.firstElementChild as HTMLElement;
    const overlay = wrapper.firstElementChild as HTMLElement;

    expect(textarea).toHaveStyle('box-sizing: border-box');
    expect(overlay).toHaveStyle('box-sizing: border-box');
  });

  it('renders the real textarea text while using the overlay only for variable highlighting', () => {
    render(
      <PromptTemplateTextarea
        value={'Latest user message: {{input}}'}
        onChange={jest.fn()}
        placeholder="Type a prompt"
      />
    );

    const textarea = screen.getByRole('textbox');
    const variable = screen.getByText('{{input}}');

    expect(getComputedStyle(textarea).color).not.toBe('transparent');
    expect(getComputedStyle(textarea).color).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(variable).color).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(variable).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(variable).not.toHaveStyle('font-weight: 500');
  });

  it('emits typed changes through the backing textarea', () => {
    const onChange = jest.fn();

    render(<PromptTemplateTextarea value="" onChange={onChange} placeholder="Type a prompt" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated prompt' } });

    expect(onChange).toHaveBeenCalledWith('Updated prompt');
  });
});
