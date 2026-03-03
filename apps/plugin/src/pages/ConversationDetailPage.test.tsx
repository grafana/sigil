import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { delay, of } from 'rxjs';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ConversationDetailPage from './ConversationDetailPage';
import type { ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail } from '../conversation/types';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({
    fetch: fetchMock,
  }),
}));

function createDataSource(conversationDetail: ConversationDetail): ConversationsDataSource {
  return {
    searchConversations: jest.fn(async () => ({
      conversations: [],
      next_cursor: '',
      has_more: false,
    })),
    getConversationDetail: jest.fn(async () => conversationDetail),
    getGeneration: jest.fn(async () => {
      throw new Error('getGeneration should not be called in ConversationDetailPage');
    }),
    getSearchTags: jest.fn(async () => []),
    getSearchTagValues: jest.fn(async () => []),
  };
}

function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

describe('ConversationDetailPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('loads conversation detail from route param and renders it', async () => {
    const detail: ConversationDetail = {
      conversation_id: 'devex-go-openai-2-1772456234117',
      generation_count: 2,
      first_generation_at: '2026-03-01T10:00:00Z',
      last_generation_at: '2026-03-01T10:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'devex-go-openai-2-1772456234117',
          created_at: '2026-03-01T10:00:00Z',
          model: { name: 'gpt-4o-mini' },
        },
      ],
      annotations: [],
    };

    const dataSource = createDataSource(detail);

    render(
      <MemoryRouter initialEntries={['/conversations/devex-go-openai-2-1772456234117/detail']}>
        <Routes>
          <Route
            path="/conversations/:conversationID/detail"
            element={<ConversationDetailPage dataSource={dataSource} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(dataSource.getConversationDetail).toHaveBeenCalledWith('devex-go-openai-2-1772456234117');
    });

    expect(await screen.findByText(/"generation_id": "gen-1"/)).toBeInTheDocument();
    expect(screen.queryByText('Conversation ID')).not.toBeInTheDocument();
    expect(screen.queryByText('Generation count')).not.toBeInTheDocument();
  });

  it('builds the trace timeline incrementally as traces load', async () => {
    const detail: ConversationDetail = {
      conversation_id: 'conv-1',
      generation_count: 2,
      first_generation_at: '2026-03-01T10:00:00Z',
      last_generation_at: '2026-03-01T10:01:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-1',
          trace_id: 'trace-1',
          created_at: '2026-03-01T10:00:00Z',
        },
        {
          generation_id: 'gen-2',
          conversation_id: 'conv-1',
          trace_id: 'trace-2',
          created_at: '2026-03-01T10:01:00Z',
        },
      ],
      annotations: [],
    };

    fetchMock.mockImplementation(({ url }: { url: string }) => {
      if (url.includes('/trace-1')) {
        return of({
          data: {
            trace: {
              resourceSpans: [
                {
                  resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }],
                  },
                  scopeSpans: [
                    {
                      spans: [
                        {
                          spanId: 'span-1',
                          name: 'first',
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
        });
      }

      return of({
        data: {
          trace: {
            resourceSpans: [
              {
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: 'svc-b' } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      {
                        spanId: 'span-2',
                        name: 'second',
                        startTimeUnixNano: '1772480417752738142',
                        endTimeUnixNano: '1772480417752752279',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }).pipe(delay(30));
    });
    const dataSource = createDataSource(detail);

    render(
      <MemoryRouter initialEntries={['/conversations/conv-1/detail']}>
        <Routes>
          <Route
            path="/conversations/:conversationID/detail"
            element={<ConversationDetailPage dataSource={dataSource} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('trace-row-trace-1')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Trace preload progress' })).not.toBeInTheDocument();

    expect(await screen.findByTestId('trace-row-trace-2')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('sets selected span in URL query params', async () => {
    const detail: ConversationDetail = {
      conversation_id: 'conv-with-spans',
      generation_count: 1,
      first_generation_at: '2026-03-01T10:00:00Z',
      last_generation_at: '2026-03-01T10:00:00Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-with-spans',
          trace_id: 'trace-1',
          mode: 'SYNC',
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180, reasoning_tokens: 12 },
          stop_reason: 'end_turn',
          created_at: '2026-03-01T10:00:00Z',
        },
      ],
      annotations: [],
    };

    fetchMock.mockImplementation(() =>
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
                        spanId: 'span-a',
                        name: 'prompt',
                        startTimeUnixNano: '1772480417611539268',
                        endTimeUnixNano: '1772480417752539268',
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

    const dataSource = createDataSource(detail);
    render(
      <MemoryRouter initialEntries={['/conversations/conv-with-spans/detail']}>
        <Routes>
          <Route
            path="/conversations/:conversationID/detail"
            element={
              <>
                <ConversationDetailPage dataSource={dataSource} />
                <LocationSearchProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Trace timeline')).not.toBeInTheDocument();

    const expandTraceButton = await screen.findByRole('button', { name: 'expand trace trace-1' });
    fireEvent.click(expandTraceButton);
    expect(await screen.findByTestId('location-search')).toHaveTextContent('?trace=trace-1');
    expect(await screen.findByRole('button', { name: 'close expanded trace' })).toBeInTheDocument();

    const spanButton = await screen.findByRole('button', { name: 'select span prompt' });
    fireEvent.mouseEnter(spanButton);
    const hoveredTooltip = await screen.findByTestId('hovered-span-tooltip');
    expect(hoveredTooltip).toBeInTheDocument();
    expect(hoveredTooltip.style.top).toBe('22px');
    expect(hoveredTooltip.style.left).toBe('50%');
    fireEvent.mouseLeave(spanButton);
    await waitFor(() => expect(screen.queryByTestId('hovered-span-tooltip')).not.toBeInTheDocument());

    fireEvent.click(spanButton);
    expect(await screen.findByTestId('location-search')).toHaveTextContent('?trace=trace-1&span=trace-1%3Aspan-a');
    expect(await screen.findByText('Selected span details')).toBeInTheDocument();
    expect(screen.getByText('Associated generation')).toBeInTheDocument();
    expect(screen.getByText('openai / gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('reasoning_tokens')).toBeInTheDocument();

    fireEvent.click(spanButton);
    expect(await screen.findByTestId('location-search')).toHaveTextContent('?trace=trace-1');

    const closeExpandedTraceButton = await screen.findByRole('button', { name: 'close expanded trace' });
    fireEvent.click(closeExpandedTraceButton);
    expect(await screen.findByTestId('location-search')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'select span prompt' })).not.toBeInTheDocument();
  });

  it('keeps raw span duration when generation created/completed are equal', async () => {
    const detail: ConversationDetail = {
      conversation_id: 'conv-fill-spans',
      generation_count: 2,
      first_generation_at: '2026-03-01T10:00:00Z',
      last_generation_at: '2026-03-01T10:00:02Z',
      generations: [
        {
          generation_id: 'gen-1',
          conversation_id: 'conv-fill-spans',
          trace_id: 'trace-1',
          created_at: '2026-03-01T10:00:00Z',
          completed_at: '2026-03-01T10:00:00Z',
        },
        {
          generation_id: 'gen-2',
          conversation_id: 'conv-fill-spans',
          trace_id: 'trace-2',
          created_at: '2026-03-01T10:00:02Z',
        },
      ],
      annotations: [],
    };

    fetchMock.mockImplementation(({ url }: { url: string }) => {
      if (url.includes('/trace-1')) {
        return of({
          data: {
            trace: {
              resourceSpans: [
                {
                  resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }],
                  },
                  scopeSpans: [
                    {
                      spans: [
                        {
                          spanId: 'span-1',
                          name: 'first',
                          startTimeUnixNano: '1772480417501516906',
                          endTimeUnixNano: '1772480417502516906',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        });
      }

      return of({
        data: {
          trace: {
            resourceSpans: [
              {
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: 'svc-b' } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      {
                        spanId: 'span-2',
                        name: 'second',
                        startTimeUnixNano: '1772480417752516906',
                        endTimeUnixNano: '1772480417762516906',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
    });

    const dataSource = createDataSource(detail);
    render(
      <MemoryRouter initialEntries={['/conversations/conv-fill-spans/detail']}>
        <Routes>
          <Route
            path="/conversations/:conversationID/detail"
            element={<ConversationDetailPage dataSource={dataSource} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const expandTraceButton = await screen.findByRole('button', { name: 'expand trace trace-1' });
    expect(parseFloat(expandTraceButton.style.width)).toBeLessThan(5);
    fireEvent.click(expandTraceButton);
    const firstSpanButton = await screen.findByRole('button', { name: 'select span first' });
    expect(parseFloat(firstSpanButton.style.width)).toBeGreaterThan(95);
  });
});
