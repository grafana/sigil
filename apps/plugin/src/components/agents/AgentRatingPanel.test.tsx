import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentRatingPanel from './AgentRatingPanel';
import type { AgentsDataSource } from '../../agents/api';
import type { AgentDetail, AgentListResponse, AgentRatingResponse, AgentVersionListResponse } from '../../agents/types';

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

describe('AgentRatingPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('polls when initial rating is pending and renders completed result', async () => {
    const lookupAgentRating = jest
      .fn<Promise<AgentRatingResponse | null>, [string, string?]>()
      .mockResolvedValueOnce(createPendingRating())
      .mockResolvedValueOnce(createCompletedRating('Final rating from polling.'));

    const dataSource = createDataSource({
      lookupAgentRating,
    });

    render(
      <AgentRatingPanel
        agentName="assistant"
        version="sha256:test"
        dataSource={dataSource}
        initialResult={createPendingRating()}
        initialLoading={true}
      />
    );

    expect(screen.getByText('Evaluating...')).toBeInTheDocument();
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

    render(<AgentRatingPanel agentName="assistant" version="sha256:test" dataSource={dataSource} />);

    fireEvent.click(screen.getByRole('button', { name: /rate this agent/i }));

    await waitFor(() => expect(rateAgent).toHaveBeenCalledWith('assistant', 'sha256:test'));
    await waitFor(() => expect(lookupAgentRating).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Rating became available after trigger.')).toBeInTheDocument();
  });
});
