import React from 'react';
import { render, screen } from '@testing-library/react';
import EvaluatorDetail from './EvaluatorDetail';
import type { Evaluator } from '../../evaluation/types';

describe('EvaluatorDetail', () => {
  it('shows effective default judge prompts when config omits them', () => {
    const evaluator: Evaluator = {
      evaluator_id: 'custom.helpfulness',
      version: '2026-03-08',
      kind: 'llm_judge',
      config: {
        max_tokens: 128,
        temperature: 0,
      },
      output_keys: [{ key: 'helpfulness', type: 'number' }],
      is_predefined: false,
      created_at: '2026-03-08T00:00:00Z',
      updated_at: '2026-03-08T00:00:00Z',
    };

    render(<EvaluatorDetail evaluator={evaluator} />);

    expect(screen.getByText('System prompt')).toBeInTheDocument();
    expect(
      screen.getByText(/You evaluate one assistant response\. Use only the user input and assistant output\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Latest user message:/)).toBeInTheDocument();
    expect(screen.getByText('{{input}}')).toBeInTheDocument();
    expect(screen.getByText('{{output}}')).toBeInTheDocument();
  });
});
