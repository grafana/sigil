import React from 'react';
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { delay, of } from 'rxjs';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    expect(screen.queryByText(/"generation_id": "gen-1"/)).not.toBeInTheDocument();
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
});
