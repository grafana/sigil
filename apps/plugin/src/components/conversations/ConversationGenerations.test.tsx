import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('loads AI spans and keeps root OTHER spans by default', async () => {
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
                        name: 'streamText gpt-4o-mini',
                        startTimeUnixNano: '1772480417578390317',
                        endTimeUnixNano: '1772480417752390317',
                        attributes: [
                          { key: 'gen_ai.operation.name', value: { stringValue: 'streamText' } },
                          { key: 'sigil.generation.id', value: { stringValue: 'gen-1' } },
                        ],
                      },
                      {
                        spanId: 'span-2',
                        name: 'db.query',
                        startTimeUnixNano: '1772480417578390318',
                        endTimeUnixNano: '1772480417752390318',
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
      },
    ];

    render(<ConversationGenerations generations={generations} />);

    expect(await screen.findByText('streamText gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('db.query')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows all spans (including OTHER) when All toggle is enabled', async () => {
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
                        name: 'streamText gpt-4o-mini',
                        startTimeUnixNano: '1772480417578390317',
                        endTimeUnixNano: '1772480417752390317',
                        attributes: [
                          { key: 'gen_ai.operation.name', value: { stringValue: 'streamText' } },
                          { key: 'sigil.generation.id', value: { stringValue: 'gen-1' } },
                        ],
                      },
                      {
                        spanId: 'span-2',
                        name: 'db.query',
                        startTimeUnixNano: '1772480417578390318',
                        endTimeUnixNano: '1772480417752390318',
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
    expect(await screen.findByText('streamText gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('db.query')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'toggle all spans' }));

    expect(await screen.findByText('db.query')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies All filter for collapsed roots and shows OTHER after manual expand', async () => {
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
                        spanId: 'span-root',
                        name: 'sigil.generation.prompt',
                        startTimeUnixNano: '1772480417578390317',
                        endTimeUnixNano: '1772480417752390317',
                        attributes: [{ key: 'sigil.generation.id', value: { stringValue: 'gen-1' } }],
                      },
                      {
                        spanId: 'span-child-other',
                        parentSpanId: 'span-root',
                        name: 'db.query',
                        startTimeUnixNano: '1772480417578390318',
                        endTimeUnixNano: '1772480417752390318',
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
      },
    ];

    render(<ConversationGenerations generations={generations} />);

    expect(await screen.findByText('sigil.generation.prompt')).toBeInTheDocument();
    expect(screen.queryByText('db.query')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'toggle all spans' }));
    expect(screen.queryByText('db.query')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'expand span sigil.generation.prompt' }));
    expect(await screen.findByText('db.query')).toBeInTheDocument();
  });

  it('keeps root OTHER spans visible by default and when All is enabled', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          trace: {
            resourceSpans: [
              {
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: 'api-service' } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      {
                        spanId: 'span-http',
                        name: 'http.client',
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
        generation_id: 'gen-empty',
        conversation_id: 'conv-1',
        trace_id: 'trace-empty',
      },
    ];

    render(<ConversationGenerations generations={generations} />);

    expect(await screen.findByText('http.client')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'toggle all spans' }));
    expect(await screen.findByText('http.client')).toBeInTheDocument();
  });
});
