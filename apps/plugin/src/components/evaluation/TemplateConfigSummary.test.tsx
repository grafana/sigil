import React from 'react';
import { render, screen } from '@testing-library/react';
import TemplateConfigSummary from './TemplateConfigSummary';

describe('TemplateConfigSummary', () => {
  it('shows effective default judge prompts when config omits them', () => {
    render(
      <TemplateConfigSummary
        kind="llm_judge"
        config={{ max_tokens: 128, temperature: 0 }}
        outputKeys={[{ key: 'helpfulness', type: 'number' }]}
      />
    );

    expect(screen.getByText('System prompt')).toBeInTheDocument();
    expect(
      screen.getByText(/You evaluate one assistant response\. Use only the user input and assistant output\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Latest user message:/)).toBeInTheDocument();
    expect(screen.getByText('{{latest_user_message}}')).toBeInTheDocument();
    expect(screen.getByText('{{assistant_response}}')).toBeInTheDocument();
  });

  it('describes the supported json schema subset', () => {
    render(
      <TemplateConfigSummary
        kind="json_schema"
        config={{ schema: { type: 'object' } }}
        outputKeys={[{ key: 'json_valid', type: 'bool' }]}
      />
    );

    expect(screen.getByText(/built-in schema subset/i)).toBeInTheDocument();
    expect(screen.getByText(/type, required, properties, items/i)).toBeInTheDocument();
  });
});
