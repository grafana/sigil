import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ConversationsDataSource } from '../conversation/api';
import ConversationDetailPage, { type ConversationDetailPageProps } from '../pages/ConversationDetailPage';
import { mockConversationDetail, mockGenerationDetail } from './mockConversationData';

const mockDataSource: ConversationsDataSource = {
  async searchConversations() {
    return {
      conversations: [],
      next_cursor: '',
      has_more: false,
    };
  },
  async getConversationDetail() {
    return mockConversationDetail;
  },
  async getGeneration() {
    return mockGenerationDetail;
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
};

const meta = {
  title: 'Sigil/Conversation Detail Page',
  component: ConversationDetailPage,
  args: {
    dataSource: mockDataSource,
  },
  render: (args: ConversationDetailPageProps) => (
    <MemoryRouter initialEntries={['/conversations/conv-xyz-789/detail']}>
      <Routes>
        <Route path="/conversations/:conversationID/detail" element={<ConversationDetailPage {...args} />} />
      </Routes>
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};
