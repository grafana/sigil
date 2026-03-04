import ExploreAssistantInsightsPanel, {
  type AssistantInsightDisplayItem,
} from '../../components/conversation-explore/ExploreAssistantInsightsPanel';

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
  component: ExploreAssistantInsightsPanel,
};

export default meta;

export const Default = {
  args: {
    isGenerating: false,
    rawAssistantText: '{"items":[]}',
    items: sampleItems,
    onSelectItem: () => {},
  },
};

export const Loading = {
  args: {
    isGenerating: true,
    rawAssistantText: '',
    items: [],
    onSelectItem: () => {},
  },
};
