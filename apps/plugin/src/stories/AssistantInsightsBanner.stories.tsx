import AssistantInsightsBanner from '../components/assistant/AssistantInsightsBanner';

const meta = {
  title: 'Assistant/AssistantInsightsBanner',
  component: AssistantInsightsBanner,
};

export default meta;

export const Waiting = {
  args: {
    prompt: 'Test prompt',
    origin: 'storybook/assistant-insights-banner',
    systemPrompt: 'Test system prompt',
    dataContext: null,
    waitingText: 'Waiting for data...',
    emptyText: 'No notable insights.',
    invalidText: 'Could not parse assistant insights.',
  },
};
