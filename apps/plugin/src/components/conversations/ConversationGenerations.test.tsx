import React from 'react';
import { render, screen } from '@testing-library/react';
import ConversationGenerations from './ConversationGenerations';
import type { GenerationDetail } from '../../conversation/types';

describe('ConversationGenerations', () => {
  it('parses token usage when protobuf values are strings', () => {
    const generations: GenerationDetail[] = [
      {
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        usage: {
          total_tokens: '180' as unknown as number,
        },
      },
      {
        generation_id: 'gen-2',
        conversation_id: 'conv-1',
        usage: {
          input_tokens: '12' as unknown as number,
          output_tokens: '34' as unknown as number,
        },
      },
    ];

    render(<ConversationGenerations generations={generations} />);

    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('12/34')).toBeInTheDocument();
  });
});
