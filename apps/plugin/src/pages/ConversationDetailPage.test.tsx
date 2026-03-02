import React from 'react';
import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
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

    expect(await screen.findByText('Conversation Detail')).toBeInTheDocument();
    expect(screen.getByText('devex-go-openai-2-1772456234117')).toBeInTheDocument();
    expect(screen.getByText(/"generation_id": "gen-1"/)).toBeInTheDocument();
  });

  it('preloads traces for generation trace IDs and shows progress', async () => {
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

    fetchMock.mockImplementation(() => of({ data: { trace: [] } }).pipe(delay(10)));
    const dataSource = createDataSource(detail);

    render(
      <MemoryRouter initialEntries={['/conversations/conv-1/detail']}>
        <Routes>
          <Route path="/conversations/:conversationID/detail" element={<ConversationDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('progressbar', { name: 'Trace preload progress' })).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByRole('progressbar', { name: 'Trace preload progress' }));
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
                        startTimeUnixNano: '1000000000',
                        endTimeUnixNano: '1100000000',
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

    const spanButton = await screen.findByRole('button', { name: 'select span prompt' });
    fireEvent.mouseEnter(spanButton);
    const hoveredTooltip = await screen.findByTestId('hovered-span-tooltip');
    expect(hoveredTooltip).toBeInTheDocument();
    expect(hoveredTooltip.style.top).toBe('22px');
    expect(hoveredTooltip.style.left).toBe('50%');
    fireEvent.mouseLeave(spanButton);
    await waitFor(() => expect(screen.queryByTestId('hovered-span-tooltip')).not.toBeInTheDocument());

    fireEvent.click(spanButton);
    expect(await screen.findByTestId('location-search')).toHaveTextContent('?span=trace-1%3Aspan-a');
    expect(await screen.findByText('Selected span details')).toBeInTheDocument();
    expect(screen.getByText('Associated generation')).toBeInTheDocument();
    expect(screen.getByText('openai / gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('reasoning_tokens')).toBeInTheDocument();

    fireEvent.click(spanButton);
    expect(await screen.findByTestId('location-search')).toHaveTextContent('');
  });

  it('fills spans to next trace start when generation created/completed are equal', async () => {
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
                          startTimeUnixNano: '1000',
                          endTimeUnixNano: '1001',
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
                        startTimeUnixNano: '2000',
                        endTimeUnixNano: '3000',
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
          <Route path="/conversations/:conversationID/detail" element={<ConversationDetailPage dataSource={dataSource} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstSpanButton = await screen.findByRole('button', { name: 'select span first' });
    expect(parseFloat(firstSpanButton.style.width)).toBeGreaterThan(25);
  });
});
