import React from 'react';
import { render, screen } from '@testing-library/react';
import type { GenerationDetail } from '../../generation/types';
import ChatThread from './ChatThread';

describe('ChatThread', () => {
  it('labels tool-result messages as tool results', () => {
    const generations: GenerationDetail[] = [
      {
        generation_id: 'gen-tool-result',
        conversation_id: 'conv-1',
        created_at: '2026-03-06T10:00:00Z',
        input: [
          {
            role: 'MESSAGE_ROLE_TOOL',
            parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: '{"hits":3}' } }],
          },
        ],
      },
    ];

    render(<ChatThread generations={generations} />);

    expect(screen.getByText('Tool Result')).toBeInTheDocument();
  });

  it('never renders system prompt text in the conversation thread', () => {
    const generations: GenerationDetail[] = [
      {
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        created_at: '2026-03-06T10:00:00Z',
        system_prompt: 'hidden system prompt',
        input: [
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'hello' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'hi' }],
          },
        ],
      },
    ];

    render(<ChatThread generations={generations} />);

    expect(screen.queryByText('System')).not.toBeInTheDocument();
    expect(screen.queryByText('hidden system prompt')).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('does not duplicate prior conversation history when later generations send cumulative input', () => {
    const generations: GenerationDetail[] = [
      {
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        created_at: '2026-03-06T10:00:00Z',
        input: [
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'first question' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'first answer' }],
          },
        ],
      },
      {
        generation_id: 'gen-2',
        conversation_id: 'conv-1',
        created_at: '2026-03-06T10:01:00Z',
        input: [
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'first question' }],
          },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'first answer' }],
          },
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'follow-up question' }],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [{ text: 'follow-up answer' }],
          },
        ],
      },
    ];

    render(<ChatThread generations={generations} />);

    expect(screen.getAllByText('first question')).toHaveLength(1);
    expect(screen.getAllByText('first answer')).toHaveLength(1);
    expect(screen.getByText('follow-up question')).toBeInTheDocument();
    expect(screen.getByText('follow-up answer')).toBeInTheDocument();
  });
});
