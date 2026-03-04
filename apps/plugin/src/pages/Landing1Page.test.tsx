import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Landing1Page from './Landing1Page';

const mockOpenAssistant = jest.fn();

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
    LinkButton: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
  };
});

jest.mock('@grafana/assistant', () => ({
  useAssistant: () => ({
    openAssistant: mockOpenAssistant,
  }),
}));

jest.mock('../components/landing/LandingTopBar', () => ({
  LandingTopBar: () => <div data-testid="landing-top-bar" />,
}));

describe('Landing1Page', () => {
  beforeEach(() => {
    mockOpenAssistant.mockReset();
  });

  it('opens assistant once when a suggested question is clicked', () => {
    render(<Landing1Page />);

    const question = 'What additional information does Sigil contain?';
    fireEvent.click(screen.getByRole('button', { name: question }));

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(mockOpenAssistant).toHaveBeenCalledWith({
      origin: 'grafana/sigil-plugin/landing1',
      prompt: question,
      autoSend: true,
    });
  });
});
