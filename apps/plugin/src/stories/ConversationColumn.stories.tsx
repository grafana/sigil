import ConversationSummaryHeader from '../components/conversations/ConversationSummaryHeader';
import { mockSearchResults } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversation Summary Header',
  component: ConversationSummaryHeader,
  args: {
    conversation: mockSearchResults[0],
  },
};

export default meta;

export const Default = {};

export const WithRatings = {
  args: {
    conversation: {
      ...mockSearchResults[0],
      rating_summary: { total_count: 5, good_count: 4, bad_count: 1, has_bad_rating: true },
    },
  },
};

export const NoModels = {
  args: {
    conversation: {
      ...mockSearchResults[1],
      models: [],
    },
  },
};
