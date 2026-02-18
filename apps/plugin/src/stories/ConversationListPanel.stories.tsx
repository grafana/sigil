import React, { useState } from 'react';
import ConversationListPanel from '../components/conversations/ConversationListPanel';
import { mockSearchResults } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversations/ConversationListPanel',
  component: ConversationListPanel,
};

export default meta;

export const WithResults = {
  render: () => {
    const [selected, setSelected] = useState(mockSearchResults[0].conversation_id);
    return (
      <ConversationListPanel
        conversations={mockSearchResults}
        selectedConversationId={selected}
        loading={false}
        hasMore={true}
        loadingMore={false}
        onSelectConversation={setSelected}
        onLoadMore={() => {}}
      />
    );
  },
};

export const Empty = {
  args: {
    conversations: [],
    selectedConversationId: '',
    loading: false,
    hasMore: false,
    loadingMore: false,
    onSelectConversation: () => {},
    onLoadMore: () => {},
  },
};

export const Loading = {
  args: {
    conversations: [],
    selectedConversationId: '',
    loading: true,
    hasMore: false,
    loadingMore: false,
    onSelectConversation: () => {},
    onLoadMore: () => {},
  },
};
