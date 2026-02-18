import React from 'react';
import { render, screen } from '@testing-library/react';
import ChatThread from './ChatThread';
import type { Message } from '../../conversation/types';

describe('ChatThread', () => {
  it('renders all messages in order', () => {
    const messages: Message[] = [
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Question one' }] },
      { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'Answer one' }] },
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Question two' }] },
      { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'Answer two' }] },
    ];
    render(<ChatThread messages={messages} />);
    expect(screen.getByText('Question one')).toBeInTheDocument();
    expect(screen.getByText('Answer one')).toBeInTheDocument();
    expect(screen.getByText('Question two')).toBeInTheDocument();
    expect(screen.getByText('Answer two')).toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    render(<ChatThread messages={[]} />);
    expect(screen.getByText('No messages to display')).toBeInTheDocument();
  });

  it('has chat messages log role', () => {
    const messages: Message[] = [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Hi' }] }];
    render(<ChatThread messages={messages} />);
    expect(screen.getByRole('log', { name: 'chat messages' })).toBeInTheDocument();
  });
});
