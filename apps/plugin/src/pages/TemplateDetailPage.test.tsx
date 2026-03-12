import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EvaluationDataSource } from '../evaluation/api';
import type {
  CreateEvaluatorRequest,
  CreateManualConversationRequest,
  CreateRuleRequest,
  CreateTemplateRequest,
  EvalTestRequest,
  EvalTestResponse,
  Evaluator,
  ForkEvaluatorRequest,
  ForkTemplateRequest,
  JudgeModelListResponse,
  JudgeProviderListResponse,
  PublishVersionRequest,
  Rule,
  RulePreviewRequest,
  RulePreviewResponse,
  SaveConversationRequest,
  SavedConversation,
  SavedConversationListResponse,
  TemplateDefinition,
  TemplateListResponse,
  TemplateVersion,
  TemplateVersionListResponse,
  UpdateRuleRequest,
} from '../evaluation/types';
import TemplateDetailPage from './TemplateDetailPage';

function createDataSource(template: TemplateDefinition): EvaluationDataSource {
  return {
    listEvaluators: async () => ({ items: [], next_cursor: '' }),
    createEvaluator: async (_request: CreateEvaluatorRequest) => ({}) as Evaluator,
    getEvaluator: async (_evaluatorID: string) => ({}) as Evaluator,
    deleteEvaluator: async () => {},
    listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
    forkPredefinedEvaluator: async (_templateID: string, _request: ForkEvaluatorRequest) => ({}) as Evaluator,
    listRules: async () => ({ items: [], next_cursor: '' }),
    createRule: async (_request: CreateRuleRequest) => ({}) as Rule,
    getRule: async (_ruleID: string) => ({}) as Rule,
    updateRule: async (_ruleID: string, _request: UpdateRuleRequest) => ({}) as Rule,
    deleteRule: async () => {},
    previewRule: async (_request: RulePreviewRequest): Promise<RulePreviewResponse> => ({
      window_hours: 24,
      total_generations: 0,
      matching_generations: 0,
      sampled_generations: 0,
      samples: [],
    }),
    listJudgeProviders: async (): Promise<JudgeProviderListResponse> => ({ providers: [] }),
    listJudgeModels: async (_provider: string): Promise<JudgeModelListResponse> => ({ models: [] }),
    testEval: async (_request: EvalTestRequest): Promise<EvalTestResponse> => ({
      generation_id: '',
      conversation_id: '',
      scores: [],
      execution_time_ms: 0,
    }),
    listTemplates: async (): Promise<TemplateListResponse> => ({ items: [template], next_cursor: '' }),
    createTemplate: async (_request: CreateTemplateRequest): Promise<TemplateDefinition> => template,
    getTemplate: async (_templateID: string): Promise<TemplateDefinition> => template,
    deleteTemplate: async () => {},
    listTemplateVersions: async (_templateID: string): Promise<TemplateVersionListResponse> => ({
      items: [],
    }),
    publishVersion: async (_templateID: string, _request: PublishVersionRequest): Promise<TemplateVersion> => ({
      tenant_id: template.tenant_id,
      template_id: template.template_id,
      version: template.latest_version,
      config: template.config ?? {},
      output_keys: template.output_keys ?? [],
      changelog: '',
      created_at: '',
    }),
    getTemplateVersion: async (_templateID: string, version: string): Promise<TemplateVersion> => ({
      tenant_id: template.tenant_id,
      template_id: template.template_id,
      version,
      config: template.config ?? {},
      output_keys: template.output_keys ?? [],
      changelog: '',
      created_at: '',
    }),
    forkTemplate: async (_templateID: string, _request: ForkTemplateRequest) => ({}) as Evaluator,
    listSavedConversations: async (): Promise<SavedConversationListResponse> => ({ items: [], next_cursor: '' }),
    saveConversation: async (_request: SaveConversationRequest) => ({}) as SavedConversation,
    getSavedConversation: async (_savedID: string) => ({}) as SavedConversation,
    deleteSavedConversation: async () => {},
    createManualConversation: async (_request: CreateManualConversationRequest) => ({}) as SavedConversation,
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
}

function renderPage(template: TemplateDefinition) {
  render(
    <MemoryRouter initialEntries={[`/evaluation/templates/${template.template_id}`]}>
      <Routes>
        <Route
          path="/evaluation/templates/:templateID"
          element={<TemplateDetailPage dataSource={createDataSource(template)} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('TemplateDetailPage', () => {
  it('hides version history for global templates', async () => {
    renderPage({
      tenant_id: '',
      template_id: 'sigil.helpfulness',
      scope: 'global',
      kind: 'llm_judge',
      description: 'Global template',
      latest_version: '2026-03-05',
      config: { provider: 'openai' },
      output_keys: [{ key: 'helpfulness', type: 'number' }],
      versions: [],
      created_at: '',
      updated_at: '',
    });

    await waitFor(() => expect(screen.getByText('Template sigil.helpfulness')).toBeInTheDocument());
    expect(screen.queryByText('Version history')).not.toBeInTheDocument();
  });

  it('shows version history for tenant templates', async () => {
    renderPage({
      tenant_id: 'tenant-1',
      template_id: 'my.template',
      scope: 'tenant',
      kind: 'llm_judge',
      description: 'Tenant template',
      latest_version: '2026-03-05',
      config: { provider: 'openai' },
      output_keys: [{ key: 'helpfulness', type: 'number' }],
      versions: [{ version: '2026-03-05', changelog: 'Initial', created_at: '2026-03-05T00:00:00Z' }],
      created_at: '2026-03-05T00:00:00Z',
      updated_at: '2026-03-05T00:00:00Z',
    });

    await waitFor(() => expect(screen.getByText('Template my.template')).toBeInTheDocument());
    expect(screen.getByText('Version history')).toBeInTheDocument();
  });
});
