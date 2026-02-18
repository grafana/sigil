import React from 'react';
import { render, screen } from '@testing-library/react';
import ChatMessage from './ChatMessage';
import type { Message } from '../../conversation/types';

describe('ChatMessage', () => {
  it('renders user message with user icon label', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_USER',
      parts: [{ text: 'Hello, how are you?' }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
  });

  it('renders assistant message with assistant label', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ text: 'I am doing well.' }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('I am doing well.')).toBeInTheDocument();
  });

  it('renders tool message with tool label', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_TOOL',
      parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: 'found 3 results' } }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('Tool')).toBeInTheDocument();
  });

  it('uses message name instead of role label when present', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_TOOL',
      name: 'search_tool',
      parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: 'result' } }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('search_tool')).toBeInTheDocument();
    expect(screen.queryByText('Tool')).not.toBeInTheDocument();
  });

  it('renders thinking block for thinking parts', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ thinking: 'Let me think about this...' }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders tool call card for tool_call parts', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ tool_call: { id: 'tc-1', name: 'search', input_json: '{"q":"test"}' } }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByLabelText('tool call search')).toBeInTheDocument();
  });

  it('renders multiple parts in order', () => {
    const message: Message = {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ thinking: 'Considering...' }, { text: 'Here is the answer.' }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.getByText('Here is the answer.')).toBeInTheDocument();
  });
});
