import ConversationsListPage from '../pages/ConversationsListPage';
import type { ConversationsDataSource } from '../conversation/api';
import { mockSearchResults } from './mockConversationData';
import { MemoryRouter } from 'react-router-dom';
import type { ConversationsListPageProps } from '../pages/ConversationsListPage';

const mockDataSource: ConversationsDataSource = {
  async searchConversations() {
    return {
      conversations: mockSearchResults,
      next_cursor: '',
      has_more: false,
    };
  },
  async getConversationDetail() {
    throw new Error('not implemented in ConversationsListPage story');
  },
  async getGeneration() {
    throw new Error('not implemented in ConversationsListPage story');
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
};

const meta = {
  title: 'Sigil/Conversations List Page',
  component: ConversationsListPage,
  args: {
    dataSource: mockDataSource,
  },
  render: (args: ConversationsListPageProps) => (
    <MemoryRouter>
      <ConversationsListPage {...args} />
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};
