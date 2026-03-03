import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { of } from 'rxjs';
import ConversationGenerations from './ConversationGenerations';
import type { GenerationDetail } from '../../conversation/types';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({
    fetch: fetchMock,
  }),
}));

describe('ConversationGenerations', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

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

    expect(screen.getByText(/180 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/12\/34 tokens/)).toBeInTheDocument();
  });

  it('loads spans only when a generation row is expanded', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          trace: {
            resourceSpans: [
              {
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: 'llm-service' } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      {
                        spanId: 'span-1',
                        name: 'llm.prompt',
                        startTimeUnixNano: '1772480417578390317',
                        endTimeUnixNano: '1772480417752390317',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      })
    );

    const generations: GenerationDetail[] = [
      {
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        trace_id: 'trace-1',
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        created_at: '2026-03-01T10:00:00Z',
      },
    ];

    render(<ConversationGenerations generations={generations} />);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('button', { name: 'toggle generation gen-1' }));

    expect(await screen.findByText('llm.prompt')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'toggle generation gen-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle generation gen-1' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
