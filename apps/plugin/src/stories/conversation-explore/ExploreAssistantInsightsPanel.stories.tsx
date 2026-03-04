import AssistantInsightsList, {
  type AssistantInsightDisplayItem,
} from '../../components/assistant/AssistantInsightsList';

const sampleItems: AssistantInsightDisplayItem[] = [
  {
    itemId: 'trace-1:span-1',
    sidebarLabel: 'generateText',
    focus: 'Highest latency generation is dominating total conversation duration.',
    tip: 'Open this span and check tool call timing before model tuning.',
  },
  {
    itemId: 'trace-1:span-3',
    sidebarLabel: 'generateText',
    focus: 'Highest cost generation likely drives spend concentration.',
    tip: 'Compare input/output token mix and tighten prompt length.',
  },
];

const meta = {
  title: 'Sigil/Conversation Explore/AssistantInsightsPanel',
  component: AssistantInsightsList,
};

export default meta;

export const Default = {
  args: {
    prompt: 'Test prompt',
    origin: 'storybook/assistant-insights',
    systemPrompt: 'Test system prompt',
    dataContext: null,
    parseItems: () => sampleItems,
    onSelectItem: () => {},
    waitingText: 'Waiting for highlighted sidebar items.',
    emptyText: 'No notable insights.',
    invalidText: 'Could not parse assistant insights.',
  },
};

export const Loading = {
  args: {
    prompt: 'Test prompt',
    origin: 'storybook/assistant-insights',
    systemPrompt: 'Test system prompt',
    dataContext: null,
    parseItems: () => [],
    onSelectItem: () => {},
    waitingText: 'Waiting for highlighted sidebar items.',
    emptyText: 'No notable insights.',
    invalidText: 'Could not parse assistant insights.',
  },
};
