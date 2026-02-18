import React, { useState } from 'react';
import GenerationViewerPanel from '../components/generation/GenerationViewerPanel';
import { mockConversationDetail, mockGenerationDetail, mockGenerationWithError } from './mockConversationData';

const meta = {
  title: 'Sigil/Generation/GenerationViewerPanel',
  component: GenerationViewerPanel,
};

export default meta;

export const WithConversation = {
  render: () => {
    const [genDetail, setGenDetail] = useState(mockGenerationDetail);
    const generations: Record<string, typeof mockGenerationDetail> = {
      'gen-abc-001': mockGenerationDetail,
      'gen-abc-002': { ...mockGenerationDetail, generation_id: 'gen-abc-002' },
      'gen-abc-003': mockGenerationWithError,
    };
    return (
      <GenerationViewerPanel
        conversationDetail={mockConversationDetail}
        generationDetail={genDetail}
        loading={false}
        onSelectGeneration={(id) => {
          const gen = generations[id];
          if (gen) {
            setGenDetail(gen);
          }
        }}
      />
    );
  },
};

export const Loading = {
  args: {
    conversationDetail: mockConversationDetail,
    generationDetail: null,
    loading: true,
    onSelectGeneration: () => {},
  },
};

export const EmptyState = {
  args: {
    conversationDetail: null,
    generationDetail: null,
    loading: false,
    onSelectGeneration: () => {},
  },
};

export const WithError = {
  args: {
    conversationDetail: mockConversationDetail,
    generationDetail: mockGenerationWithError,
    loading: false,
    onSelectGeneration: () => {},
  },
};
