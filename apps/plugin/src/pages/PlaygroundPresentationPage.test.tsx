import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlaygroundPresentationPage from './PlaygroundPresentationPage';

describe('PlaygroundPresentationPage', () => {
  it('renders markdown from the text query param and preserves line breaks', () => {
    const markdown = encodeURIComponent('# Slide Title\n\n- first\n- second\n\nline 1\nline 2\n\n**Bold**');

    render(
      <MemoryRouter initialEntries={[`/?text=${markdown}`]}>
        <PlaygroundPresentationPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Slide Title' })).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.getByText('Bold', { selector: 'strong' })).toBeInTheDocument();
    const paragraphWithLineBreak = screen.getByText((content) => content.includes('line 1') && content.includes('line 2'));
    expect(paragraphWithLineBreak.innerHTML).toContain('line 1\nline 2');
  });
});
