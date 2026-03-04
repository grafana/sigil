import React from 'react';
import type { ConversationsDataSource } from '../conversation/api';
import type { DashboardDataSource } from '../dashboard/api';
import { mockSearchResults } from './mockConversationData';
import { MemoryRouter } from 'react-router-dom';
import ConversationsBrowserPage, { type ConversationsBrowserPageProps } from '../pages/ConversationsBrowserPage';

const mockDashboardDataSource: DashboardDataSource = {
  async queryRange() {
    return { status: 'success', data: { resultType: 'matrix', result: [] } };
  },
  async queryInstant() {
    return { status: 'success', data: { resultType: 'vector', result: [] } };
  },
  async labels() {
    return [];
  },
  async labelValues() {
    return [];
  },
  async resolveModelCards() {
    return {
      resolved: [],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
  },
};

const mockDataSource: ConversationsDataSource = {
  async listConversations() {
    return {
      items: mockSearchResults.map((conversation) => ({
        id: conversation.conversation_id,
        title: conversation.conversation_id,
        last_generation_at: conversation.last_generation_at,
        generation_count: conversation.generation_count,
        created_at: conversation.first_generation_at,
        updated_at: conversation.last_generation_at,
        rating_summary: conversation.rating_summary,
      })),
    };
  },
  async searchConversations() {
    return {
      conversations: mockSearchResults,
      next_cursor: '',
      has_more: false,
    };
  },
  async getConversationDetail() {
    throw new Error('not implemented in ConversationsBrowserPage story');
  },
  async getGeneration() {
    throw new Error('not implemented in ConversationsBrowserPage story');
  },
  async getSearchTags() {
    return [];
  },
  async getSearchTagValues() {
    return [];
  },
};

const meta = {
  title: 'Sigil/Conversations Browser Page',
  component: ConversationsBrowserPage,
  args: {
    dataSource: mockDataSource,
    dashboardDataSource: mockDashboardDataSource,
  },
  render: (args: ConversationsBrowserPageProps) => (
    <MemoryRouter>
      <ConversationsBrowserPage {...args} />
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};
