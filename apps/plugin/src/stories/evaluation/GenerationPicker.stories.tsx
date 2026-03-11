import React, { useState } from 'react';
import GenerationPicker from '../../components/evaluation/GenerationPicker';
import type { ConversationsDataSource } from '../../conversation/api';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { SavedConversation } from '../../evaluation/types';

const mockSavedConversations: SavedConversation[] = [
  {
    tenant_id: 'tenant-1',
    saved_id: 'sc-support-regression',
    conversation_id: 'conv-abc-123',
    name: 'Support regression - token limit hit',
    source: 'telemetry',
    tags: { use_case: 'support', priority: 'high' },
    saved_by: 'operator-jane',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
  },
  {
    tenant_id: 'tenant-1',
    saved_id: 'sc-edge-case-empty',
    conversation_id: 'conv_manual_sc-edge-case-empty',
    name: 'Edge case - empty assistant response',
    source: 'manual',
    tags: { category: 'edge_case' },
    saved_by: 'operator-jane',
    created_at: '2026-03-02T14:30:00Z',
    updated_at: '2026-03-02T14:30:00Z',
  },
];

const mockConvDs: ConversationsDataSource = {
  listConversations: async () => ({
    items: [
      {
        id: 'conv-abc-123',
        last_generation_at: '2026-03-01T10:00:00Z',
        generation_count: 3,
        created_at: '2026-03-01T09:55:00Z',
        updated_at: '2026-03-01T10:00:00Z',
      },
    ],
  }),
  searchConversations: async () => ({ conversations: [], has_more: false }),
  getConversationDetail: async (id) => ({
    conversation_id: id,
    generation_count: 2,
    first_generation_at: '2026-03-01T09:55:00Z',
    last_generation_at: '2026-03-01T10:00:00Z',
    generations: [
      {
        generation_id: 'gen-001',
        conversation_id: id,
        model: { provider: 'openai', name: 'gpt-4' },
        created_at: '2026-03-01T10:00:00Z',
        messages: [],
      } as never,
      {
        generation_id: 'gen-002',
        conversation_id: id,
        model: { provider: 'openai', name: 'gpt-4' },
        created_at: '2026-03-01T09:55:00Z',
        messages: [],
      } as never,
    ],
    annotations: [],
  }),
  getGeneration: async () => ({}) as never,
  getSearchTags: async () => [],
  getSearchTagValues: async () => [],
};

const mockEvalDs: Partial<EvaluationDataSource> = {
  listSavedConversations: async () => ({ items: mockSavedConversations, next_cursor: '' }),
  listCollections: async () => ({
    items: [
      {
        tenant_id: 't',
        collection_id: 'col-1',
        name: 'Auth Regression',
        description: '',
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
        member_count: 3,
      },
      {
        tenant_id: 't',
        collection_id: 'col-2',
        name: 'Streaming Edge Cases',
        description: '',
        created_by: 'user-1',
        updated_by: 'user-1',
        created_at: '2026-03-02T00:00:00Z',
        updated_at: '2026-03-02T00:00:00Z',
        member_count: 1,
      },
    ],
    next_cursor: '',
  }),
  listCollectionMembers: async () => ({ items: mockSavedConversations.slice(0, 1), next_cursor: '' }),
};

function GenerationPickerWrapper({ saved }: { saved: SavedConversation[] }) {
  const [selected, setSelected] = useState<string | undefined>();
  const evalDs: Partial<EvaluationDataSource> = {
    listSavedConversations: async () => ({ items: saved, next_cursor: '' }),
    listCollections: async () => ({
      items: [
        {
          tenant_id: 't',
          collection_id: 'col-1',
          name: 'Auth Regression',
          description: '',
          created_by: 'user-1',
          updated_by: 'user-1',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          member_count: 3,
        },
        {
          tenant_id: 't',
          collection_id: 'col-2',
          name: 'Streaming Edge Cases',
          description: '',
          created_by: 'user-1',
          updated_by: 'user-1',
          created_at: '2026-03-02T00:00:00Z',
          updated_at: '2026-03-02T00:00:00Z',
          member_count: 1,
        },
      ],
      next_cursor: '',
    }),
    listCollectionMembers: async () => ({ items: saved.slice(0, 1), next_cursor: '' }),
  };
  return (
    <div style={{ maxWidth: 480 }}>
      <GenerationPicker
        onSelect={setSelected}
        selectedGenerationId={selected}
        conversationsDataSource={mockConvDs}
        evaluationDataSource={evalDs as EvaluationDataSource}
      />
      <p style={{ marginTop: 8, fontSize: 12, color: '#888' }}>Selected: {selected ?? 'none'}</p>
    </div>
  );
}

const meta = {
  title: 'Sigil/Evaluation/GenerationPicker',
  component: GenerationPicker,
};

export default meta;

export const SavedTab = {
  render: () => <GenerationPickerWrapper saved={mockSavedConversations} />,
};

export const SavedTabEmpty = {
  render: () => <GenerationPickerWrapper saved={[]} />,
};

export const RecentTab = {
  render: () => {
    const Wrapper = () => {
      const [selected, setSelected] = useState<string | undefined>();
      return (
        <div style={{ maxWidth: 480 }}>
          <GenerationPicker
            onSelect={setSelected}
            selectedGenerationId={selected}
            conversationsDataSource={mockConvDs}
            evaluationDataSource={mockEvalDs as EvaluationDataSource}
          />
        </div>
      );
    };
    return <Wrapper />;
  },
};
