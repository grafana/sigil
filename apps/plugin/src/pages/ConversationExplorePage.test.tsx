import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConversationExplorePage from './ConversationExplorePage';
import { useConversationData } from '../hooks/useConversationData';
import { useSavedConversation } from '../hooks/useSavedConversation';
import { useConversationFlow } from '../components/conversation-explore/useConversationFlow';

jest.mock('../hooks/useConversationData', () => ({
  useConversationData: jest.fn(),
}));

jest.mock('../hooks/useSavedConversation', () => ({
  useSavedConversation: jest.fn(),
}));

jest.mock('../components/conversation-explore/useConversationFlow', () => ({
  useConversationFlow: jest.fn(),
}));

jest.mock('../components/conversation-explore/MetricsBar', () => {
  return function MetricsBarMock() {
    return <div data-testid="metrics-bar">metrics</div>;
  };
});

jest.mock('../components/conversation-explore/MiniTimeline', () => {
  return function MiniTimelineMock() {
    return <div data-testid="mini-timeline">timeline</div>;
  };
});

jest.mock('../components/conversation-explore/FlowTree', () => {
  return function FlowTreeMock() {
    return <div data-testid="flow-tree">tree</div>;
  };
});

jest.mock('../components/conversation-explore/DetailPanel', () => {
  return function DetailPanelMock(props: { onOpenAgentContext?: (context: unknown) => void }) {
    return (
      <div data-testid="detail-panel">
        <button
          type="button"
          aria-label="open agent drawer"
          onClick={() =>
            props.onOpenAgentContext?.({
              label: 'assistant · gpt-4.1',
              model: 'gpt-4.1',
              extraTags: ['openai', 'stop: end_turn'],
              systemPrompt: 'You are in assistant mode.',
              tools: [{ name: 'weather' }],
              agentDetailUrl:
                '/a/grafana-sigil-app/agents/name/assistant?version=sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            })
          }
        >
          Open drawer
        </button>
      </div>
    );
  };
});

jest.mock('../components/insight/PageInsightBar', () => ({
  PageInsightBar: () => <div data-testid="insight-bar">insight</div>,
}));

const mockedUseConversationData = useConversationData as jest.MockedFunction<typeof useConversationData>;
const mockedUseSavedConversation = useSavedConversation as jest.MockedFunction<typeof useSavedConversation>;
const mockedUseConversationFlow = useConversationFlow as jest.MockedFunction<typeof useConversationFlow>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/conversations/conv-1/explore?node=gen-node']}>
      <Routes>
        <Route path="/conversations/:conversationID/explore" element={<ConversationExplorePage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ConversationExplorePage', () => {
  beforeEach(() => {
    mockedUseConversationData.mockReturnValue({
      conversationData: { generationCount: 1 } as never,
      loading: false,
      tracesLoading: false,
      errorMessage: '',
      tokenSummary: null,
      costSummary: null,
      generationCosts: new Map(),
      modelCards: new Map(),
      allGenerations: [],
    });
    mockedUseSavedConversation.mockReturnValue({
      isSaved: false,
      loading: false,
      toggleSave: jest.fn(async () => true),
    });
    mockedUseConversationFlow.mockReturnValue({
      flowNodes: [
        {
          id: 'gen-node',
          kind: 'generation',
          label: 'generation',
          durationMs: 125,
          startMs: 0,
          status: 'success',
          generation: { generation_id: 'gen-1', conversation_id: 'conv-1' },
          children: [],
        } as never,
      ],
      totalDurationMs: 125,
    });
  });

  it('collapses and expands the left timeline/tree rail with the corner tab icon', () => {
    renderPage();

    expect(screen.getByTestId('mini-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('flow-tree')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse flow panel'));
    expect(screen.queryByTestId('mini-timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flow-tree')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Expand flow panel'));
    expect(screen.getByTestId('mini-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('flow-tree')).toBeInTheDocument();
  });

  it('opens and closes an in-page agent drawer from detail panel context', () => {
    renderPage();

    fireEvent.click(screen.getByLabelText('open agent drawer'));

    const drawer = screen.getByRole('dialog', { name: 'Agent context drawer' });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
    expect(screen.getByText('assistant · gpt-4.1')).toBeInTheDocument();
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('weather')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open agent page' })).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/agents/name/assistant?version=sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );

    fireEvent.click(screen.getByLabelText('Close agent drawer'));
    expect(screen.queryByRole('dialog', { name: 'Agent context drawer' })).not.toBeInTheDocument();
  });
});
