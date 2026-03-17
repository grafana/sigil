import React from 'react';
import EvalTestPanel from '../../components/evaluation/EvalTestPanel';
import type { ConversationsDataSource } from '../../conversation/api';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { SavedConversation } from '../../evaluation/types';

const savedConversations: SavedConversation[] = [
  {
    tenant_id: 'tenant-1',
    saved_id: 'sc-support-regression',
    conversation_id: 'conv-abc-123',
    name: 'Support regression - token limit hit',
    source: 'telemetry',
    tags: { use_case: 'support' },
    saved_by: 'operator-jane',
    created_at: '2026-03-09T12:00:00Z',
    updated_at: '2026-03-09T12:00:00Z',
    generation_count: 0,
    total_tokens: 0,
    agent_names: [],
  },
];

const conversationsDataSource: ConversationsDataSource = {
  listConversations: async () => ({
    items: [
      {
        id: 'conv-abc-123',
        last_generation_at: '2026-03-09T12:00:00Z',
        generation_count: 2,
        created_at: '2026-03-09T11:55:00Z',
        updated_at: '2026-03-09T12:00:00Z',
      },
    ],
  }),
  searchConversations: async () => ({ conversations: [], has_more: false }),
  getConversationDetail: async () => ({
    conversation_id: 'conv-abc-123',
    generation_count: 2,
    first_generation_at: '2026-03-09T11:55:00Z',
    last_generation_at: '2026-03-09T12:00:00Z',
    generations: [
      {
        generation_id: 'gen-1',
        conversation_id: 'conv-abc-123',
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        input: [],
        output: [],
        created_at: '2026-03-09T12:00:00Z',
      } as never,
      {
        generation_id: 'gen-2',
        conversation_id: 'conv-abc-123',
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        input: [],
        output: [],
        created_at: '2026-03-09T11:57:00Z',
      } as never,
    ],
    annotations: [],
  }),
  getGeneration: async (generationID) => ({
    generation_id: generationID,
    conversation_id: 'conv-abc-123',
    model: { provider: 'openai', name: 'gpt-4o-mini' },
    input: [],
    output: [],
    created_at: '2026-03-09T12:00:00Z',
  }),
  getSearchTags: async () => [],
  getSearchTagValues: async () => [],
};

const evaluationDataSource: EvaluationDataSource = {
  listEvaluators: async () => ({ items: [], next_cursor: '' }),
  createEvaluator: async () => ({}) as never,
  getEvaluator: async () => ({}) as never,
  deleteEvaluator: async () => {},
  listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
  forkPredefinedEvaluator: async () => ({}) as never,
  listRules: async () => ({ items: [], next_cursor: '' }),
  createRule: async () => ({}) as never,
  getRule: async () => ({}) as never,
  updateRule: async () => ({}) as never,
  deleteRule: async () => {},
  previewRule: async () => ({}) as never,
  listJudgeProviders: async () => ({ providers: [] }),
  listJudgeModels: async () => ({ models: [] }),
  testEval: async (request) => ({
    generation_id: request.generation_id ?? '',
    conversation_id: request.conversation_id ?? 'conv-abc-123',
    scores: [
      {
        key: 'heuristic_pass',
        type: 'bool',
        value: true,
        passed: true,
        explanation: 'Assistant response is not empty.',
      },
    ],
    execution_time_ms: 12,
  }),
  listTemplates: async () => ({ items: [], next_cursor: '' }),
  createTemplate: async () => ({}) as never,
  getTemplate: async () => ({}) as never,
  deleteTemplate: async () => {},
  listTemplateVersions: async () => ({ items: [] }),
  publishVersion: async () => ({}) as never,
  getTemplateVersion: async () => ({}) as never,
  forkTemplate: async () => ({}) as never,
  listSavedConversations: async () => ({ items: savedConversations, next_cursor: '' }),
  saveConversation: async () => ({}) as never,
  getSavedConversation: async () => ({}) as never,
  deleteSavedConversation: async () => {},
  createManualConversation: async () => ({}) as never,
  listCollections: async () => ({ items: [], next_cursor: '' }),
  createCollection: async () => ({}) as never,
  getCollection: async () => ({}) as never,
  updateCollection: async () => ({}) as never,
  deleteCollection: async () => {},
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
  listCollectionMembers: async () => ({ items: [], next_cursor: '' }),
  listCollectionsForSavedConversation: async () => ({ items: [], next_cursor: '' }),
};

const meta = {
  title: 'Sigil/Evaluation/EvalTestPanel',
  component: EvalTestPanel,
};

export default meta;

export const Heuristic = {
  render: () => (
    <div style={{ maxWidth: 840, padding: 16 }}>
      <EvalTestPanel
        kind="heuristic"
        config={{
          version: 'v2',
          root: {
            kind: 'group',
            operator: 'and',
            rules: [{ kind: 'rule', type: 'not_empty' }],
          },
        }}
        outputKeys={[{ key: 'heuristic_pass', type: 'bool' }]}
        dataSource={evaluationDataSource}
        conversationsDataSource={conversationsDataSource}
      />
    </div>
  ),
};
