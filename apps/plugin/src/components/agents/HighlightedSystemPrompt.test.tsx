import React from 'react';
import { render, screen } from '@testing-library/react';
import { HighlightedSystemPrompt, findHighlightRanges } from './HighlightedSystemPrompt';
import type { PromptInsightsResponse } from '../../agents/types';

const samplePrompt =
  'You are a helpful assistant. Always explain step by step. Never execute destructive ops. Be concise.';

const sampleInsights: PromptInsightsResponse = {
  status: 'completed',
  strengths: [{ quote: 'Always explain step by step', title: 'Good reasoning', explanation: 'Agent reasons well' }],
  weaknesses: [{ quote: 'Be concise', title: 'Too vague', explanation: 'Inconsistent response length' }],
  judge_model: 'openai/gpt-4o-mini',
  judge_latency_ms: 100,
};

describe('findHighlightRanges', () => {
  it('finds matching quotes in text', () => {
    const ranges = findHighlightRanges(samplePrompt, sampleInsights);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].kind).toBe('strength');
    expect(ranges[0].insight.quote).toBe('Always explain step by step');
    expect(ranges[1].kind).toBe('weakness');
    expect(ranges[1].insight.quote).toBe('Be concise');
  });

  it('returns empty array when no quotes match', () => {
    const noMatch: PromptInsightsResponse = {
      ...sampleInsights,
      strengths: [{ quote: 'not in text', title: 'x', explanation: 'y' }],
      weaknesses: [],
    };
    const ranges = findHighlightRanges(samplePrompt, noMatch);
    expect(ranges).toHaveLength(0);
  });

  it('removes overlapping ranges', () => {
    const overlapping: PromptInsightsResponse = {
      ...sampleInsights,
      strengths: [
        { quote: 'Always explain step by step', title: 'A', explanation: 'a' },
        { quote: 'explain step', title: 'B', explanation: 'b' },
      ],
      weaknesses: [],
    };
    const ranges = findHighlightRanges(samplePrompt, overlapping);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].insight.title).toBe('A');
  });
});

describe('HighlightedSystemPrompt', () => {
  it('renders plain text when no insights', () => {
    render(<HighlightedSystemPrompt systemPrompt={samplePrompt} insights={null} />);
    expect(screen.getByText(samplePrompt)).toBeInTheDocument();
    expect(screen.queryByTestId('highlighted-system-prompt')).not.toBeInTheDocument();
  });

  it('renders highlighted text when insights are available', () => {
    render(<HighlightedSystemPrompt systemPrompt={samplePrompt} insights={sampleInsights} />);
    const container = screen.getByTestId('highlighted-system-prompt');
    expect(container).toBeInTheDocument();

    const strengthMarks = screen.getAllByTestId('prompt-insight-strength');
    expect(strengthMarks).toHaveLength(1);
    expect(strengthMarks[0].textContent).toBe('Always explain step by step');

    const weaknessMarks = screen.getAllByTestId('prompt-insight-weakness');
    expect(weaknessMarks).toHaveLength(1);
    expect(weaknessMarks[0].textContent).toBe('Be concise');
  });

  it('renders plain text when insights are pending', () => {
    const pending: PromptInsightsResponse = {
      status: 'pending',
      strengths: [],
      weaknesses: [],
      judge_model: '',
      judge_latency_ms: 0,
    };
    render(<HighlightedSystemPrompt systemPrompt={samplePrompt} insights={pending} />);
    expect(screen.queryByTestId('highlighted-system-prompt')).not.toBeInTheDocument();
  });

  it('renders fallback for empty prompt', () => {
    render(<HighlightedSystemPrompt systemPrompt="" insights={null} />);
    expect(screen.getByText('No system prompt recorded.')).toBeInTheDocument();
  });

  it('adds data-insight-index attributes on mark elements', () => {
    render(<HighlightedSystemPrompt systemPrompt={samplePrompt} insights={sampleInsights} />);
    const strengthMark = screen.getByTestId('prompt-insight-strength');
    expect(strengthMark.getAttribute('data-insight-index')).toBe('0');
    expect(strengthMark.getAttribute('data-insight-kind')).toBe('strength');

    const weaknessMark = screen.getByTestId('prompt-insight-weakness');
    expect(weaknessMark.getAttribute('data-insight-index')).toBe('0');
    expect(weaknessMark.getAttribute('data-insight-kind')).toBe('weakness');
  });
});
