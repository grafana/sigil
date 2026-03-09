import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ConversationSpan } from '../conversation/types';
import ConversationExplorePage from './ConversationExplorePage';

const mockSceneQueryRunner = jest.fn();
const mockTracePanelSetOption = jest.fn();

jest.mock('@grafana/i18n', () => ({
  initPluginTranslations: jest.fn().mockResolvedValue(undefined),
  i18n: {
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  },
  t: (key: string, defaultValue?: string) => defaultValue ?? key,
}));

jest.mock('@grafana/scenes', () => {
  class MockEmbeddedScene {
    Component = () => null;

    constructor(public args: unknown) {}
  }

  class MockSceneFlexItem {
    constructor(public args: unknown) {}
  }

  class MockSceneFlexLayout {
    constructor(public args: unknown) {}
  }

  class MockSceneQueryRunner {
    constructor(public args: unknown) {
      mockSceneQueryRunner(args);
    }
  }

  class MockSceneTimeRange {
    constructor(public args: unknown) {}
  }

  function makeTracePanelBuilder() {
    return {
      setHoverHeader() {
        return this;
      },
      setOption(key: string, value: string) {
        mockTracePanelSetOption(key, value);
        return this;
      },
      build() {
        return {};
      },
    };
  }

  return {
    EmbeddedScene: MockEmbeddedScene,
    PanelBuilders: {
      traces: () => makeTracePanelBuilder(),
    },
    SceneFlexItem: MockSceneFlexItem,
    SceneFlexLayout: MockSceneFlexLayout,
    SceneQueryRunner: MockSceneQueryRunner,
    SceneTimeRange: MockSceneTimeRange,
  };
});

jest.mock('../hooks/useConversationData', () => ({
  useConversationData: jest.fn(() => ({
    conversationData: {
      conversationID: 'conv-1',
      conversationTitle: 'Conversation 1',
      generationCount: 1,
      firstGenerationAt: '2026-03-01T10:00:00Z',
      lastGenerationAt: '2026-03-01T10:01:00Z',
      ratingSummary: null,
      annotations: [],
      spans: [],
      orphanGenerations: [],
    },
    loading: false,
    tracesLoading: false,
    errorMessage: '',
    tokenSummary: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    costSummary: { totalCost: 0.01 },
    generationCosts: new Map(),
    modelCards: new Map(),
    allGenerations: [],
  })),
}));

jest.mock('../hooks/useSavedConversation', () => ({
  useSavedConversation: jest.fn(() => ({
    isSaved: false,
    loading: false,
    toggleSave: jest.fn(),
  })),
}));

jest.mock('../hooks/useConversationAssistantContext', () => ({
  useConversationAssistantContext: jest.fn(),
}));

jest.mock('../components/conversation-explore/MetricsBar', () => ({
  __esModule: true,
  default: () => <div>Metrics</div>,
}));

jest.mock('../components/conversation-explore/FlowTree', () => ({
  __esModule: true,
  default: () => <div>FlowTree</div>,
}));

jest.mock('../components/conversation-explore/MiniTimeline', () => ({
  __esModule: true,
  default: () => <div>MiniTimeline</div>,
}));

jest.mock('../components/conversation-explore/DetailPanel', () => ({
  __esModule: true,
  default: ({ onOpenTraceDrawer }: { onOpenTraceDrawer: (span: ConversationSpan) => void }) => (
    <button
      type="button"
      onClick={() =>
        onOpenTraceDrawer({
          traceID: 'AQIDBAUGBwgJCgsMDQ4PEA==',
          spanID: 'AQIDBAUGBwg=',
          parentSpanID: '',
          name: 'span-1',
          kind: 'INTERNAL',
          serviceName: 'sigil',
          startTimeUnixNano: BigInt(0),
          endTimeUnixNano: BigInt(1_000_000),
          durationNano: BigInt(1_000_000),
          attributes: new Map(),
          resourceAttributes: new Map(),
          generation: null,
          children: [],
        })
      }
    >
      Open trace
    </button>
  ),
}));

jest.mock('../components/insight/PageInsightBar', () => ({
  PageInsightBar: () => <div>InsightBar</div>,
}));

jest.mock('../module', () => ({
  plugin: {
    meta: {
      id: 'grafana-sigil-app',
      jsonData: { tempoDatasourceUID: 'tempo-uid' },
    },
  },
}));

describe('ConversationExplorePage', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  beforeEach(() => {
    mockSceneQueryRunner.mockReset();
    mockTracePanelSetOption.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 1000;
      },
    });
  });

  afterEach(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
  });

  it('opens the trace drawer at half of the available content width', async () => {
    render(
      <MemoryRouter initialEntries={['/conversations/conv-1/explore']}>
        <Routes>
          <Route path="/conversations/:conversationID/explore" element={<ConversationExplorePage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open trace' }));

    await waitFor(() => {
      const resizeHandle = screen.getByRole('separator', { name: 'Resize trace drawer' });
      const drawer = resizeHandle.nextElementSibling as HTMLDivElement | null;
      expect(drawer).not.toBeNull();
      expect(drawer).toHaveStyle({ width: '500px' });
    });
  });

  it('restores the original sidebar state after repeated trace opens', async () => {
    render(
      <MemoryRouter initialEntries={['/conversations/conv-1/explore']}>
        <Routes>
          <Route path="/conversations/:conversationID/explore" element={<ConversationExplorePage />} />
        </Routes>
      </MemoryRouter>
    );

    const openTraceButton = screen.getByRole('button', { name: 'Open trace' });

    fireEvent.click(openTraceButton);
    fireEvent.click(openTraceButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close trace drawer' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close trace drawer' }));

    await waitFor(() => {
      expect(screen.getByRole('separator', { name: 'Resize flow panel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
    });
  });

  it('normalizes trace and span IDs before opening the Grafana trace drawer', async () => {
    render(
      <MemoryRouter initialEntries={['/conversations/conv-1/explore']}>
        <Routes>
          <Route path="/conversations/:conversationID/explore" element={<ConversationExplorePage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open trace' }));

    await waitFor(() => {
      expect(mockSceneQueryRunner).toHaveBeenCalled();
    });

    expect(mockSceneQueryRunner).toHaveBeenLastCalledWith(
      expect.objectContaining({
        datasource: { uid: 'tempo-uid' },
        queries: [
          expect.objectContaining({
            refId: 'A',
            query: '0102030405060708090a0b0c0d0e0f10',
            queryType: 'traceql',
          }),
        ],
      })
    );
    expect(mockTracePanelSetOption).toHaveBeenCalledWith('focusedSpanId', '0102030405060708');
  });
});
