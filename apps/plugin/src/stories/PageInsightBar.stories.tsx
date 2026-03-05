import React from 'react';
import { PageInsightBar, type PageInsightBarProps } from '../components/insight/PageInsightBar';

const meta = {
  title: 'Sigil/PageInsightBar',
  component: PageInsightBar,
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ maxWidth: 960, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

const sampleDataContext = [
  'Total Requests: 12,345',
  'Error Rate: 2.3%',
  'Avg Latency P95: 0.45s',
  'Total Tokens: 89,000',
  'Total Cost: $12.50',
].join('\n');

export const WaitingForData = {
  args: {
    prompt: 'Analyze this dashboard.',
    origin: 'storybook/page-insight',
    dataContext: null,
  } satisfies PageInsightBarProps,
};

export const WithDataContext = {
  args: {
    prompt: 'Analyze this GenAI observability dashboard. Only flag significant findings.',
    origin: 'storybook/page-insight',
    dataContext: sampleDataContext,
  } satisfies PageInsightBarProps,
};

export const DashboardContext = {
  args: {
    prompt: 'Analyze this GenAI observability dashboard. Breakdown: none. Latency percentile: p95. Cost mode: tokens.',
    origin: 'sigil-plugin/dashboard-insight',
    dataContext: [
      'Total Requests: 5,231',
      'Error Rate (%): 1.8',
      'Latency P95 (seconds): 0.62',
      'Total tokens: 1,240,000',
      'Estimated total cost (USD): $3.72',
    ].join('\n'),
    systemPrompt:
      'You are a concise observability analyst. Return exactly 2-3 findings. Each finding is a single short sentence on its own line prefixed with "- ". Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only.',
  } satisfies PageInsightBarProps,
};

export const AgentsContext = {
  args: {
    prompt:
      'Analyze this agent fleet overview. Flag concentration risks, anomalies in usage patterns, or agents that need attention.',
    origin: 'sigil-plugin/agents-insight',
    dataContext: [
      'Agents in time range: 12',
      'Total generations (runtime): 8,420',
      'Total runtime tokens: 2,150,000',
      'Anonymous agent buckets: 3',
      'Stale agents (> 7 days): 2',
      'High churn agents (5+ versions): 1',
      'Top agents by generations:',
      '  code-review-agent: 3200 generations',
      '  chat-assistant: 2100 generations',
      '  summarizer: 1800 generations',
    ].join('\n'),
  } satisfies PageInsightBarProps,
};

export const ConversationsContext = {
  args: {
    prompt:
      'Analyze these conversation metrics. Flag quality concerns, unusual patterns, or notable trends vs the previous period.',
    origin: 'sigil-plugin/conversations-browser-insight',
    dataContext: [
      'Conversations: 342 (previous window: 290)',
      'Total tokens: 1,850,000 (previous: 1,420,000)',
      'Avg calls per conversation: 4.2 (previous: 3.8)',
      'Bad-rated %: 12.5% (previous: 8.2%)',
      'Conversations with errors: 18',
    ].join('\n'),
  } satisfies PageInsightBarProps,
};
