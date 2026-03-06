import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ConversationSpan } from '../conversation/types';
import ConversationExplorePage from './ConversationExplorePage';

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
          traceID: 'trace-1',
          spanID: 'abcdef0123456789',
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
      jsonData: {},
    },
  },
}));

describe('ConversationExplorePage', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  beforeEach(() => {
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
});
