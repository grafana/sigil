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
    const conversations = mockSearchResults.map((conversation, index) =>
      index === 0 ? { ...conversation, conversation_title: 'Incident: payment retries in EU region' } : conversation
    );
    const [selected, setSelected] = useState(conversations[0].conversation_id);
    return (
      <ConversationListPanel
        conversations={conversations}
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

export const ExtendedColumns = {
  render: () => {
    const conversations = mockSearchResults.map((conversation, index) =>
      index === 0 ? { ...conversation, conversation_title: 'Incident: payment retries in EU region' } : conversation
    );
    const [selected, setSelected] = useState('');
    return (
      <div style={{ height: 600 }}>
        <ConversationListPanel
          conversations={conversations}
          selectedConversationId={selected}
          loading={false}
          hasMore={false}
          loadingMore={false}
          showExtendedColumns
          onSelectConversation={setSelected}
          onLoadMore={() => {}}
        />
      </div>
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
