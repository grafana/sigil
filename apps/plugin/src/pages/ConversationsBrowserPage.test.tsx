import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation, useParams } from 'react-router-dom';
import ConversationsBrowserPage from './ConversationsBrowserPage';
import type { ConversationsDataSource } from '../conversation/api';
import { buildConversationTagDiscoveryQuery } from '../conversation/searchTagScope';
import type { FilterToolbarProps } from '../components/filters/FilterToolbar';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    TimeRangeInput: () => <div data-testid="time-range-input" />,
    TimeRangePicker: () => <div data-testid="time-range-picker" />,
  };
});

const mockFilterToolbar = jest.fn<void, [FilterToolbarProps]>();

jest.mock('../components/filters/FilterToolbar', () => ({
  FilterToolbar: (props: FilterToolbarProps) => {
    mockFilterToolbar(props);
    return (
      <div data-testid="filter-toolbar">
        <div>{props.showLabelFilterRow ? 'Label filters open' : 'Label filters closed'}</div>
        {props.children}
      </div>
    );
  },
}));

type MockConversationsDataSource = {
  [Key in keyof ConversationsDataSource as NonNullable<ConversationsDataSource[Key]> extends (...args: any[]) => any
    ? Key
    : never]: jest.MockedFunction<NonNullable<ConversationsDataSource[Key]>>;
};

beforeAll(() => {
  global.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [{ target, contentRect: { width: 800, height: 200 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  if (typeof globalThis.Request === 'undefined') {
    class RequestMock {
      method: string;

      constructor(_input: unknown, init?: { method?: string }) {
        this.method = String(init?.method ?? 'GET').toUpperCase();
      }
    }
    Object.defineProperty(globalThis, 'Request', {
      writable: true,
      configurable: true,
      value: RequestMock,
    });
  }
});

function ExploreRouteProbe() {
  const { conversationID = '' } = useParams<{ conversationID?: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return (
    <div>
      <div>Explore route</div>
      <div>{`Conversation ID: ${conversationID}`}</div>
      <div>{`Conversation title: ${params.get('conversationTitle') ?? ''}`}</div>
    </div>
  );
}

function createDataSource(): MockConversationsDataSource {
  const currentConversations = [
    {
      conversation_id: 'conv-b',
      generation_count: 3,
      first_generation_at: '2026-02-01T10:00:00Z',
      last_generation_at: '2026-02-01T10:00:00Z',
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      annotation_count: 0,
    },
    {
      conversation_id: 'conv-a',
      generation_count: 1,
      first_generation_at: '2026-02-02T10:00:00Z',
      last_generation_at: '2026-02-02T10:00:00Z',
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      annotation_count: 0,
    },
  ];
  return {
    listConversations: jest.fn(async () => ({ items: [] })),
    searchConversations: jest
      .fn()
      .mockResolvedValueOnce({
        conversations: currentConversations,
        next_cursor: '',
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: [],
        next_cursor: '',
        has_more: false,
      }),
    getConversationDetail: jest.fn(async (_conversationID: string) => {
      return {
        conversation_id: _conversationID,
        generation_count: 2,
        first_generation_at: '2026-02-01T10:00:00Z',
        last_generation_at: '2026-02-01T10:01:00Z',
        generations: [
          {
            generation_id: `${_conversationID}-gen-1`,
            conversation_id: _conversationID,
            created_at: '2026-02-01T10:00:00Z',
            model: { provider: 'openai', name: 'gpt-4o-mini' },
            usage: { total_tokens: 120 },
          },
          {
            generation_id: `${_conversationID}-gen-2`,
            conversation_id: _conversationID,
            created_at: '2026-02-01T10:01:00Z',
            model: { provider: 'openai', name: 'gpt-4o-mini' },
            usage: { total_tokens: 180 },
          },
        ],
        annotations: [],
      };
    }),
    getGeneration: jest.fn(async (_generationID: string) => {
      throw new Error('getGeneration not used in ConversationsBrowserPage');
    }),
    getSearchTags: jest.fn(async (_from: string, _to: string) => []),
    getSearchTagValues: jest.fn(async (_tag: string, _from: string, _to: string) => []),
    getConversationStats: jest.fn(async (_request) => ({
      totalConversations: 0,
      totalTokens: 0,
      avgCallsPerConversation: 0,
      activeLast7d: 0,
      ratedConversations: 0,
      badRatedPct: 0,
    })),
  };
}

function createStreamingDataSource(): MockConversationsDataSource {
  const currentConversations = [
    {
      conversation_id: 'conv-stream-b',
      generation_count: 3,
      first_generation_at: '2026-02-01T10:00:00Z',
      last_generation_at: '2026-02-01T10:00:00Z',
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      annotation_count: 0,
    },
    {
      conversation_id: 'conv-stream-a',
      generation_count: 1,
      first_generation_at: '2026-02-02T10:00:00Z',
      last_generation_at: '2026-02-02T10:00:00Z',
      models: [],
      agents: [],
      error_count: 0,
      has_errors: false,
      trace_ids: [],
      annotation_count: 0,
    },
  ];

  const dataSource = createDataSource();
  dataSource.searchConversations.mockReset();
  dataSource.searchConversations.mockResolvedValue({
    conversations: [],
    next_cursor: '',
    has_more: false,
  });
  dataSource.streamSearchConversations = jest
    .fn()
    .mockImplementationOnce(async (_request, options) => {
      options.onResults([currentConversations[0]]);
      options.onResults([currentConversations[1]]);
      options.onComplete({ next_cursor: '', has_more: false });
    })
    .mockImplementationOnce(async (_request, options) => {
      options.onComplete({ next_cursor: '', has_more: false });
    });

  return dataSource;
}

describe('ConversationsBrowserPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilterToolbar.mockClear();
    window.sessionStorage.clear();
  });

  function renderPage(dataSource: ConversationsDataSource, initialEntry = '/conversations') {
    const router = createMemoryRouter(
      [
        {
          path: '/conversations/:conversationID/explore',
          element: <ExploreRouteProbe />,
        },
        {
          path: '/conversations',
          element: <ConversationsBrowserPage dataSource={dataSource} />,
        },
      ],
      { initialEntries: [initialEntry] }
    );

    return {
      router,
      ...render(<RouterProvider router={router} />),
    };
  }

  it('shows expanded list when no selection, then shows summary after selecting', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(dataSource);

    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalled());
    expect(dataSource.getConversationStats).toHaveBeenCalledTimes(1);
    expect(dataSource.searchConversations.mock.calls[0][0].select).toContain('span.gen_ai.usage.input_tokens');
    expect(dataSource.searchConversations.mock.calls[0][0].select).toContain('span.gen_ai.usage.output_tokens');
    expect(dataSource.searchConversations.mock.calls[0][0].select).toContain(
      'span.gen_ai.usage.cache_read_input_tokens'
    );
    expect(dataSource.searchConversations.mock.calls[0][0].select).toContain(
      'span.gen_ai.usage.cache_write_input_tokens'
    );
    expect(dataSource.searchConversations.mock.calls[0][0].select).toContain('span.gen_ai.usage.reasoning_tokens');
    expect(dataSource.searchConversations.mock.calls[0][0].select).toHaveLength(5);

    expect(await screen.findByLabelText('select conversation conv-a')).toBeInTheDocument();
    expect(screen.queryByText('Explore route')).not.toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('select conversation conv-b'));
    expect(await screen.findByText('Explore route')).toBeInTheDocument();
    expect(screen.getByText('Conversation ID: conv-b')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/conversations/conv-b/explore');
    expect(screen.queryByLabelText('select conversation conv-b')).not.toBeInTheDocument();
  });

  it('propagates conversation title to conversation explore URL and header', async () => {
    const dataSource = createDataSource();
    dataSource.searchConversations = jest
      .fn()
      .mockResolvedValueOnce({
        conversations: [
          {
            conversation_id: 'conv-b',
            conversation_title: 'Incident: authentication failures',
            generation_count: 3,
            first_generation_at: '2026-02-01T10:00:00Z',
            last_generation_at: '2026-02-01T10:00:00Z',
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            annotation_count: 0,
          },
        ],
        next_cursor: '',
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: [],
        next_cursor: '',
        has_more: false,
      });

    const { router } = renderPage(dataSource);

    expect(await screen.findByLabelText('select conversation conv-b')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('select conversation conv-b'));

    expect(router.state.location.pathname).toBe('/conversations/conv-b/explore');
    expect(router.state.location.search).toContain('conversationTitle=Incident%3A+authentication+failures');
    expect(await screen.findByText('Conversation title: Incident: authentication failures')).toBeInTheDocument();
  });

  it('uses the title returned by search for the listing without fetching conversation detail', async () => {
    const dataSource = createDataSource();
    dataSource.searchConversations = jest
      .fn()
      .mockResolvedValueOnce({
        conversations: [
          {
            conversation_id: 'conv-b',
            conversation_title: 'Recovered search title',
            generation_count: 3,
            first_generation_at: '2026-02-01T10:00:00Z',
            last_generation_at: '2026-02-01T10:00:00Z',
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            annotation_count: 0,
          },
        ],
        next_cursor: '',
        has_more: false,
      })
      .mockResolvedValueOnce({
        conversations: [],
        next_cursor: '',
        has_more: false,
      });

    const { router } = renderPage(dataSource);

    expect(await screen.findByText('Recovered search title')).toBeInTheDocument();
    expect(dataSource.getConversationDetail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('select conversation conv-b'));

    expect(router.state.location.pathname).toBe('/conversations/conv-b/explore');
    expect(router.state.location.search).toContain('conversationTitle=Recovered+search+title');
  });

  it('uses streaming search when the data source provides it', async () => {
    const dataSource = createStreamingDataSource();
    renderPage(dataSource);

    expect(await screen.findByLabelText('select conversation conv-stream-a')).toBeInTheDocument();
    await waitFor(() => expect(dataSource.streamSearchConversations).toHaveBeenCalledTimes(1));
    expect(dataSource.getConversationStats).toHaveBeenCalledTimes(1);
    expect(dataSource.searchConversations).not.toHaveBeenCalled();
  });

  it('starts previous-window stats only after the first current stream batch', async () => {
    let resolveFirstBatch: (() => void) | undefined;
    const firstBatchReady = new Promise<void>((resolve) => {
      resolveFirstBatch = resolve;
    });
    let resolveCurrent: (() => void) | undefined;
    const currentDone = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    let resolvePreviousStats: (() => void) | undefined;
    const previousStatsDone = new Promise<void>((resolve) => {
      resolvePreviousStats = resolve;
    });

    const dataSource = createDataSource();
    dataSource.searchConversations.mockReset();
    dataSource.searchConversations.mockResolvedValue({
      conversations: [],
      next_cursor: '',
      has_more: false,
    });
    dataSource.streamSearchConversations = jest.fn().mockImplementationOnce(async (_request, options) => {
      await firstBatchReady;
      options.onResults([
        {
          conversation_id: 'conv-live',
          generation_count: 2,
          first_generation_at: '2026-02-02T09:59:00Z',
          last_generation_at: '2026-02-02T10:00:00Z',
          models: [],
          agents: [],
          error_count: 0,
          has_errors: false,
          trace_ids: [],
          annotation_count: 0,
        },
      ]);
      await currentDone;
      options.onComplete({ next_cursor: '', has_more: false });
    });
    dataSource.getConversationStats!.mockImplementationOnce(async (_request) => {
      await previousStatsDone;
      return {
        totalConversations: 12,
        totalTokens: 2400,
        avgCallsPerConversation: 2,
        activeLast7d: 12,
        ratedConversations: 3,
        badRatedPct: 33,
      };
    });

    renderPage(dataSource);

    await waitFor(() => expect(dataSource.streamSearchConversations).toHaveBeenCalledTimes(1));
    expect(dataSource.getConversationStats).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirstBatch?.();
      await Promise.resolve();
    });

    expect(await screen.findByLabelText('select conversation conv-live')).toBeInTheDocument();
    expect(screen.queryByLabelText('loading conversations')).not.toBeInTheDocument();
    expect(screen.getByText('Loaded 1 conversations')).toBeInTheDocument();
    expect(dataSource.getConversationStats).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCurrent?.();
      resolvePreviousStats?.();
      await Promise.resolve();
    });
  });

  it('aborts in-flight stream searches on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const dataSource = createDataSource();
    dataSource.searchConversations.mockReset();
    dataSource.searchConversations.mockResolvedValue({
      conversations: [],
      next_cursor: '',
      has_more: false,
    });
    dataSource.streamSearchConversations = jest.fn().mockImplementation(async (_request, options) => {
      capturedSignal = options.signal;
      await new Promise(() => {});
    });

    const rendered = renderPage(dataSource);

    await waitFor(() => expect(dataSource.streamSearchConversations).toHaveBeenCalledTimes(1));
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    rendered.unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('shows the label filter row when label filters are present in the URL', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(dataSource, '/conversations?label=service_name%7C%3D%7Csigil-api');

    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalled());
    await waitFor(() =>
      expect(router.state.location.search).toContain('label=resource.service.name%7C%3D%7Csigil-api')
    );
    expect(router.state.location.search).not.toContain('service_name');
    const toolbarProps = mockFilterToolbar.mock.lastCall?.[0];
    expect(toolbarProps?.hideLabelFilters).toBeUndefined();
    expect(toolbarProps?.showLabelFilterRow).toBe(true);
    expect(toolbarProps?.filters.labelFilters).toEqual([
      { key: 'resource.service.name', operator: '=', value: 'sigil-api' },
    ]);
    expect(screen.getByText('Label filters open')).toBeInTheDocument();
  });

  it('drops unsupported analytics labels from the conversations URL state', async () => {
    const dataSource = createDataSource();
    const { router } = renderPage(
      dataSource,
      '/conversations?label=job%7C%3D%7Calloy&label=resource.sigil.devex.language%7C%3D%7Cgo'
    );

    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalled());
    await waitFor(() =>
      expect(router.state.location.search).toContain('label=resource.sigil.devex.language%7C%3D%7Cgo')
    );
    expect(router.state.location.search).not.toContain('job%7C%3D%7Calloy');

    const toolbarProps = mockFilterToolbar.mock.lastCall?.[0];
    expect(toolbarProps?.filters.labelFilters).toEqual([
      { key: 'resource.sigil.devex.language', operator: '=', value: 'go' },
    ]);
  });

  it('keeps conversation attribute filters visible as conversation keys in the shared toolbar', async () => {
    const dataSource = createDataSource();
    renderPage(dataSource, '/conversations?label=resource.service.name%7C%3D%7Csigil-api');

    await waitFor(() => expect(dataSource.searchConversations).toHaveBeenCalledTimes(1));
    const toolbarProps = mockFilterToolbar.mock.lastCall?.[0];
    expect(toolbarProps?.filters.labelFilters).toEqual([
      { key: 'resource.service.name', operator: '=', value: 'sigil-api' },
    ]);
  });

  it('scopes tag discovery and tag values to sigil conversation spans', async () => {
    const dataSource = createDataSource();
    dataSource.getSearchTags.mockResolvedValue([
      { key: 'resource.k8s.namespace.name', scope: 'resource' },
      { key: 'span.http.route', scope: 'span' },
    ]);
    dataSource.getSearchTagValues.mockImplementation(async (tag: string) => {
      if (tag === 'span.gen_ai.provider.name') {
        return ['openai'];
      }
      if (tag === 'span.gen_ai.request.model') {
        return ['gpt-4o'];
      }
      if (tag === 'span.gen_ai.agent.name') {
        return ['assistant'];
      }
      if (tag === 'resource.k8s.namespace.name') {
        return ['prod'];
      }
      return [];
    });

    renderPage(dataSource, '/conversations?label=resource.k8s.namespace.name%7C%3D%7Cprod');

    await waitFor(() => expect(dataSource.getSearchTags).toHaveBeenCalled());

    const scopedQuery = buildConversationTagDiscoveryQuery({
      providers: [],
      models: [],
      agentNames: [],
      labelFilters: [{ key: 'resource.k8s.namespace.name', operator: '=', value: 'prod' }],
    });
    expect(dataSource.getSearchTags).toHaveBeenCalledWith(expect.any(String), expect.any(String), scopedQuery);

    const toolbarProps = mockFilterToolbar.mock.lastCall?.[0];
    expect(toolbarProps?.loadLabelValues).toBeDefined();

    await act(async () => {
      await toolbarProps?.loadLabelValues?.({ key: 'resource.k8s.namespace.name', operator: '=', value: 'prod' });
    });

    expect(dataSource.getSearchTagValues).toHaveBeenCalledWith(
      'resource.k8s.namespace.name',
      expect.any(String),
      expect.any(String),
      '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" }'
    );
  });

  it('loads provider, model, and agent options from scoped Tempo tag values', async () => {
    const dataSource = createDataSource();
    dataSource.getSearchTagValues.mockImplementation(
      async (tag: string, _from: string, _to: string, query?: string) => {
        if (tag === 'span.gen_ai.provider.name') {
          expect(query).toBe(
            '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" && resource.k8s.namespace.name = "prod" }'
          );
          return ['openai'];
        }
        if (tag === 'span.gen_ai.request.model') {
          expect(query).toBe(
            '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" && resource.k8s.namespace.name = "prod" }'
          );
          return ['gpt-4o'];
        }
        if (tag === 'span.gen_ai.agent.name') {
          expect(query).toBe(
            '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" && resource.k8s.namespace.name = "prod" }'
          );
          return ['assistant'];
        }
        return [];
      }
    );

    renderPage(dataSource, '/conversations?label=resource.k8s.namespace.name%7C%3D%7Cprod');

    await waitFor(() =>
      expect(dataSource.getSearchTagValues).toHaveBeenCalledWith(
        'span.gen_ai.provider.name',
        expect.any(String),
        expect.any(String),
        expect.any(String)
      )
    );
    expect(dataSource.getSearchTagValues).toHaveBeenCalledWith(
      'span.gen_ai.request.model',
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
    expect(dataSource.getSearchTagValues).toHaveBeenCalledWith(
      'span.gen_ai.agent.name',
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });

  it('keeps successful conversation filter options when one Tempo lookup fails', async () => {
    const dataSource = createDataSource();
    dataSource.getSearchTags.mockResolvedValue([
      { key: 'resource.k8s.namespace.name', scope: 'resource' },
      { key: 'span.http.route', scope: 'span' },
    ]);
    dataSource.getSearchTagValues.mockImplementation(async (tag: string) => {
      if (tag === 'span.gen_ai.provider.name') {
        return ['openai'];
      }
      if (tag === 'span.gen_ai.request.model') {
        return ['gpt-4o'];
      }
      if (tag === 'span.gen_ai.agent.name') {
        throw new Error('tempo failed');
      }
      return [];
    });

    renderPage(dataSource);

    await waitFor(() => expect(dataSource.getSearchTags).toHaveBeenCalled());
    await waitFor(() => {
      const toolbarProps = mockFilterToolbar.mock.lastCall?.[0];
      expect(toolbarProps?.providerOptions).toEqual(['openai']);
      expect(toolbarProps?.modelOptions).toEqual(['gpt-4o']);
      expect(toolbarProps?.agentOptions).toEqual([]);
      expect(toolbarProps?.labelKeyOptions).toEqual(['resource.k8s.namespace.name', 'span.http.route']);
      expect(toolbarProps?.labelsLoading).toBe(false);
    });
  });
});
