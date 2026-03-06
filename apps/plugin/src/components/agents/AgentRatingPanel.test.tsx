import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentRatingPanel from './AgentRatingPanel';
import type { AgentsDataSource } from '../../agents/api';
import type { AgentDetail, AgentListResponse, AgentRatingResponse, AgentVersionListResponse } from '../../agents/types';

const mockOpenAssistant = jest.fn();
const mockInlineGenerate = jest.fn();
let mockInlineIsGenerating = false;
let mockInlineContent = '';
let consoleErrorSpy: jest.SpyInstance;

jest.mock('@grafana/assistant', () => ({
  createAssistantContextItem: (type: string, params: { title?: string; data?: unknown }) => ({
    node: {
      id: `${type}-${params.title ?? 'context'}`,
      name: params.title ?? 'Context',
      title: params.title ?? 'Context',
      navigable: false,
      data: params.data ?? {},
    },
    occurrences: [],
  }),
  useAssistant: () => ({
    openAssistant: mockOpenAssistant,
  }),
  useInlineAssistant: () => ({
    generate: mockInlineGenerate,
    isGenerating: mockInlineIsGenerating,
    content: mockInlineContent,
  }),
}));

function createCompletedRating(summary = 'Great overall structure.'): AgentRatingResponse {
  return {
    status: 'completed',
    score: 9,
    summary,
    suggestions: [],
    judge_model: 'openai/gpt-4o-mini',
    judge_latency_ms: 123,
  };
}

function createPendingRating(): AgentRatingResponse {
  return {
    status: 'pending',
    score: 0,
    summary: '',
    suggestions: [],
    judge_model: '',
    judge_latency_ms: 0,
  };
}

function createDataSource(overrides: Partial<AgentsDataSource>): AgentsDataSource {
  return {
    listAgents: async () => ({ items: [], next_cursor: '' }) satisfies AgentListResponse,
    lookupAgent: async () =>
      ({
        agent_name: 'assistant',
        effective_version: 'sha256:test',
        first_seen_at: '2026-03-04T09:00:00Z',
        last_seen_at: '2026-03-04T11:00:00Z',
        generation_count: 1,
        system_prompt: 'prompt',
        system_prompt_prefix: 'prompt',
        tool_count: 0,
        token_estimate: { system_prompt: 1, tools_total: 1, total: 2 },
        tools: [],
        models: [],
      }) satisfies AgentDetail,
    listAgentVersions: async () => ({ items: [], next_cursor: '' }) satisfies AgentVersionListResponse,
    lookupAgentRating: async () => null,
    rateAgent: async () => createCompletedRating(),
    ...overrides,
  };
}

function renderPanel(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('AgentRatingPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockOpenAssistant.mockReset();
    mockInlineGenerate.mockReset();
    mockInlineIsGenerating = false;
    mockInlineContent = '';
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('polls when initial rating is pending and renders completed result', async () => {
    const lookupAgentRating = jest
      .fn<Promise<AgentRatingResponse | null>, [string, string?]>()
      .mockResolvedValueOnce(createPendingRating())
      .mockResolvedValueOnce(createCompletedRating('Final rating from polling.'));

    const dataSource = createDataSource({
      lookupAgentRating,
    });

    renderPanel(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={createPendingRating()}
        initialLoading={true}
      />
    );

    expect(screen.getByRole('progressbar', { name: /loading conversation/i })).toBeInTheDocument();
    await waitFor(() => expect(lookupAgentRating).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(await screen.findByText('Final rating from polling.')).toBeInTheDocument();
  });

  it('starts polling after clicking rate when backend returns pending', async () => {
    const rateAgent = jest
      .fn<Promise<AgentRatingResponse>, [string, string?]>()
      .mockResolvedValue(createPendingRating());
    const lookupAgentRating = jest
      .fn<Promise<AgentRatingResponse | null>, [string, string?]>()
      .mockResolvedValue(createCompletedRating('Rating became available after trigger.'));

    const dataSource = createDataSource({
      rateAgent,
      lookupAgentRating,
    });

    renderPanel(<AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} />);

    fireEvent.click(screen.getByRole('button', { name: /generate analysis/i }));

    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));
    await waitFor(() => expect(lookupAgentRating).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Rating became available after trigger.')).toBeInTheDocument();
  });

  it('keeps polling when lookup briefly returns 404 after rerun', async () => {
    const completed = createCompletedRating('Existing report remains while rerun starts.');
    const rateAgent = jest
      .fn<Promise<AgentRatingResponse>, [string, string?]>()
      .mockResolvedValue(createPendingRating());
    const lookupAgentRating = jest
      .fn<Promise<AgentRatingResponse | null>, [string, string?]>()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(createCompletedRating('Fresh rerun rating.'));
    const dataSource = createDataSource({
      rateAgent,
      lookupAgentRating,
    });

    renderPanel(
      <AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} initialResult={completed} />
    );

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }));

    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));
    await waitFor(() => expect(lookupAgentRating).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('progressbar', { name: /loading conversation/i })).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(await screen.findByText('Fresh rerun rating.')).toBeInTheDocument();
  });

  it('does not auto-run rating until generate is clicked', async () => {
    const rateAgent = jest
      .fn<Promise<AgentRatingResponse>, [string, string?]>()
      .mockResolvedValue(createCompletedRating());
    const dataSource = createDataSource({
      rateAgent,
      lookupAgentRating: jest.fn(async () => null),
    });

    renderPanel(<AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} />);

    expect(rateAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /generate analysis/i }));
    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));
    expect(await screen.findByText('Great overall structure.')).toBeInTheDocument();
  });

  it('renders a succinct analysis summary', async () => {
    const rateAgent = jest.fn<Promise<AgentRatingResponse>, [string, string?]>().mockResolvedValue({
      status: 'completed',
      score: 8,
      summary:
        'This is a very long summary that should be shortened for readability in the panel because users only need the key takeaway from the analysis and not every detail in one block of text.',
      suggestions: [
        {
          severity: 'low',
          category: 'format',
          title: 'Low priority tweak',
          description: 'Low severity details that should not displace high priority recommendations.',
        },
        {
          severity: 'high',
          category: 'safety',
          title: 'High priority fix',
          description:
            'Use explicit constraints to prevent unsafe tool execution and remove ambiguous permission language across workflows.',
        },
        {
          severity: 'medium',
          category: 'clarity',
          title: 'Medium priority fix',
          description: 'Tighten instruction wording to avoid contradictory requirements in edge cases.',
        },
        {
          severity: 'low',
          category: 'style',
          title: 'Another low priority tweak',
          description: 'This fourth suggestion should be hidden to keep the output succinct.',
        },
      ],
      judge_model: 'openai/gpt-4o-mini',
      judge_latency_ms: 77,
    });
    const dataSource = createDataSource({ rateAgent });

    renderPanel(<AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} />);

    fireEvent.click(screen.getByRole('button', { name: /generate analysis/i }));
    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));

    const summaryText = await screen.findByText(/This is a very long summary that should be shortened/i);
    expect(summaryText.textContent).toContain('...');
    expect(summaryText.textContent).not.toContain('not every detail in one block of text.');
    expect(screen.getByText('High priority fix')).toBeInTheDocument();
    expect(screen.getByText('Medium priority fix')).toBeInTheDocument();
    expect(screen.getByText('Low priority tweak')).toBeInTheDocument();
    expect(screen.getByText('Another low priority tweak')).toBeInTheDocument();
  });

  it('opens summary modal with full summary text', async () => {
    const longSummary =
      'This is a very long summary that should be shortened for readability in the panel because users only need the key takeaway from the analysis and not every detail in one block of text.';
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={createCompletedRating(longSummary)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open full rating summary/i }));

    const dialog = await screen.findByRole('dialog', { name: /rating summary/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(longSummary)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /close rating summary modal/i }));
    expect(screen.queryByRole('dialog', { name: /rating summary/i })).not.toBeInTheDocument();
  });

  it('keeps findings scrollable while actions stay outside the findings region', () => {
    const completed = createCompletedRating('Short summary');
    completed.suggestions = Array.from({ length: 12 }, (_, index) => ({
      severity: index < 4 ? 'high' : index < 8 ? 'medium' : 'low',
      category: 'tools',
      title: `Suggestion ${index + 1}`,
      description: `Detailed recommendation ${index + 1} for improving tool routing and prompt clarity.`,
    }));
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} initialResult={completed} />
    );

    const findings = screen.getByLabelText('Agent rating findings');
    const actions = screen.getByLabelText('Agent rating actions');

    expect(within(findings).queryByRole('button', { name: /rewrite prompt/i })).not.toBeInTheDocument();
    expect(within(findings).queryByRole('button', { name: /re-run/i })).not.toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: /rewrite prompt/i })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: /re-run/i })).toBeInTheDocument();
  });

  it('opens assistant from summary modal explain action', async () => {
    const completed = createCompletedRating('Prompt is mostly clear but tool boundaries are vague.');
    completed.suggestions = [
      {
        severity: 'high',
        category: 'security_review',
        title: 'Constrain tool calls',
        description: 'Add strict allow/deny criteria and explicit fallback behavior.',
      },
    ];
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={completed}
        agentStateContext="- Current prompt has broad tool permissions."
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open full rating summary/i }));

    const dialog = await screen.findByRole('dialog', { name: /rating summary/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Explain' }));

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /rating summary/i })).not.toBeInTheDocument();
    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'sigil-agent-rating',
        autoSend: true,
        prompt: expect.stringContaining('Start a collaborative discovery conversation about these findings.'),
      })
    );
  });

  it('opens assistant from summary explain link with full report context', async () => {
    const completed = createCompletedRating('Prompt is mostly clear but tool boundaries are vague.');
    completed.suggestions = [
      {
        severity: 'high',
        category: 'security_review',
        title: 'Constrain tool calls',
        description: 'Add strict allow/deny criteria and explicit fallback behavior.',
      },
    ];
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={completed}
        agentStateContext="- Current prompt has broad tool permissions."
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'sigil-agent-rating',
        autoSend: true,
        prompt: expect.stringContaining('Start a collaborative discovery conversation about these findings.'),
      })
    );
    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.arrayContaining([
          expect.objectContaining({
            node: expect.objectContaining({ title: 'Rating summary' }),
          }),
        ]),
      })
    );
    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.arrayContaining([
          expect.objectContaining({
            node: expect.objectContaining({ title: 'Suggestions' }),
          }),
        ]),
      })
    );
  });

  it('opens assistant from modal explain action', async () => {
    const completed = createCompletedRating('Short summary');
    completed.suggestions = [
      {
        severity: 'high',
        category: 'safety',
        title: 'Constrain tool calls',
        description: 'Add explicit safety constraints for tool invocation.',
      },
    ];
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} initialResult={completed} />
    );

    fireEvent.click(screen.getByRole('button', { name: /open suggestion constrain tool calls/i }));
    const dialog = await screen.findByRole('dialog', { name: /suggestion constrain tool calls/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Explain' }));

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /suggestion constrain tool calls/i })).not.toBeInTheDocument();
    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'sigil-agent-rating',
        autoSend: true,
      })
    );
  });

  it('removes suggestion when rejected from modal', async () => {
    const completed = createCompletedRating('Short summary');
    completed.suggestions = [
      {
        severity: 'medium',
        category: 'clarity',
        title: 'Tighten wording',
        description: 'Reduce ambiguity in instruction phrasing.',
      },
    ];
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} initialResult={completed} />
    );

    expect(screen.getByText('Tighten wording')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open suggestion tighten wording/i }));
    const dialog = await screen.findByRole('dialog', { name: /suggestion tighten wording/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));

    expect(screen.queryByText('Tighten wording')).not.toBeInTheDocument();
  });

  it('opens a modal when clicking a suggestion title', async () => {
    const completed = createCompletedRating('Short summary');
    completed.suggestions = [
      {
        severity: 'high',
        category: 'safety',
        title: 'Constrain tool calls',
        description: 'Add explicit safety constraints for tool invocation.',
      },
    ];
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} initialResult={completed} />
    );

    fireEvent.click(screen.getByRole('button', { name: /open suggestion constrain tool calls/i }));

    const dialog = await screen.findByRole('dialog', { name: /suggestion constrain tool calls/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Add explicit safety constraints for tool invocation.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(screen.queryByRole('dialog', { name: /suggestion constrain tool calls/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Constrain tool calls')).not.toBeInTheDocument();
  });

  it('opens rewrite prompt modal and generates markdown from rating context', async () => {
    const completed = createCompletedRating('Prompt has strong intent but unclear tool boundaries.');
    completed.suggestions = [
      {
        severity: 'high',
        category: 'safety',
        title: 'Constrain tool calls',
        description: 'Add explicit tool safety boundaries and fallback behavior.',
      },
    ];
    mockInlineGenerate.mockImplementation(({ onComplete }: { onComplete?: (result: string) => void }) => {
      onComplete?.('## Rewritten system prompt\n\n```text\nYou are a safer assistant.\n```');
    });
    const dataSource = createDataSource({});

    renderPanel(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={completed}
        agentStateContext="- Current system prompt: You are helpful."
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rewrite prompt/i }));

    const dialog = await screen.findByRole('dialog', { name: /rewrite prompt/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Rewritten system prompt' })).toBeInTheDocument();
    expect(within(dialog).getByText('You are a safer assistant.')).toBeInTheDocument();
    expect(mockInlineGenerate).toHaveBeenCalledTimes(1);
    expect(mockInlineGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'sigil-agent-rating-rewrite',
        prompt: expect.stringContaining('Prompt has strong intent but unclear tool boundaries.'),
        systemPrompt: expect.stringContaining('You are an expert prompt engineer.'),
      })
    );
  });

  it('keeps last completed report visible when re-run fails', async () => {
    const dataSource = createDataSource({
      rateAgent: jest.fn(async () => {
        throw new Error('backend unavailable');
      }),
    });
    const completed = createCompletedRating('Existing report should stay visible.');

    renderPanel(
      <AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} initialResult={completed} />
    );

    expect(screen.getByText('Existing report should stay visible.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }));

    expect(await screen.findByText('backend unavailable')).toBeInTheDocument();
    expect(screen.getByText('Existing report should stay visible.')).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Agent rating generation failed',
      expect.objectContaining({
        agentName: 'assistant',
        version: 'sha256:test',
      })
    );
  });

  it('calls onRerun callback before starting rerun', async () => {
    const onRerun = jest.fn();
    const rateAgent = jest
      .fn<Promise<AgentRatingResponse>, [string, string?]>()
      .mockResolvedValue(createCompletedRating());
    const dataSource = createDataSource({ rateAgent });

    renderPanel(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={createCompletedRating('Existing report')}
        onRerun={onRerun}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }));

    expect(onRerun).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));
  });

  it('keeps rerun request alive when parent syncs onResultChange', async () => {
    const initial = createCompletedRating('Existing report');
    const pending = createPendingRating();
    const refreshed = createCompletedRating('Fresh rerun result');
    const rateAgent = jest.fn<Promise<AgentRatingResponse>, [string, string?]>().mockResolvedValue(pending);
    const lookupAgentRating = jest
      .fn<Promise<AgentRatingResponse | null>, [string, string?]>()
      .mockResolvedValue(refreshed);
    const dataSource = createDataSource({ rateAgent, lookupAgentRating });

    function Harness() {
      const [rating, setRating] = React.useState<AgentRatingResponse | null>(initial);
      return (
        <AgentRatingPanel
          agentName="assistant"
          version="sha256:test"
          dataSource={dataSource}
          initialResult={rating}
          onResultChange={setRating}
        />
      );
    }

    renderPanel(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }));

    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));
    await waitFor(() => expect(lookupAgentRating).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Fresh rerun result')).toBeInTheDocument();
  });
});
