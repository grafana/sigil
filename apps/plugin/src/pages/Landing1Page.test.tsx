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

describe('Landing1Page', () => {
  beforeEach(() => {
    mockOpenAssistant.mockReset();
  });

  it('opens assistant only once when submit button is clicked', () => {
    render(<Landing1Page />);

    fireEvent.change(screen.getByPlaceholderText('Ask me anything about Sigil'), {
      target: { value: 'How does Sigil work?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(mockOpenAssistant).toHaveBeenCalledWith({
      origin: 'grafana/sigil-plugin/landing1',
      prompt: 'How does Sigil work?',
      autoSend: true,
    });
  });
});
