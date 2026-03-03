import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import type {
  CreateEvaluatorRequest,
  CreateRuleRequest,
  Evaluator,
  EvaluatorListResponse,
  ForkEvaluatorRequest,
  JudgeModelListResponse,
  JudgeProviderListResponse,
  Rule,
  RuleListResponse,
  RulePreviewRequest,
  RulePreviewResponse,
  UpdateRuleRequest,
} from './types';

const evalBasePath = '/api/plugins/grafana-sigil-app/resources/eval';

export type EvaluationDataSource = {
  listEvaluators: (limit?: number, cursor?: string) => Promise<EvaluatorListResponse>;
  createEvaluator: (request: CreateEvaluatorRequest) => Promise<Evaluator>;
  getEvaluator: (evaluatorID: string) => Promise<Evaluator>;
  deleteEvaluator: (evaluatorID: string) => Promise<void>;
  listPredefinedEvaluators: () => Promise<EvaluatorListResponse>;
  forkPredefinedEvaluator: (templateID: string, request: ForkEvaluatorRequest) => Promise<Evaluator>;
  listRules: (limit?: number, cursor?: string) => Promise<RuleListResponse>;
  createRule: (request: CreateRuleRequest) => Promise<Rule>;
  getRule: (ruleID: string) => Promise<Rule>;
  updateRule: (ruleID: string, request: UpdateRuleRequest) => Promise<Rule>;
  deleteRule: (ruleID: string) => Promise<void>;
  previewRule: (request: RulePreviewRequest) => Promise<RulePreviewResponse>;
  listJudgeProviders: () => Promise<JudgeProviderListResponse>;
  listJudgeModels: (provider: string) => Promise<JudgeModelListResponse>;
};

export const defaultEvaluationDataSource: EvaluationDataSource = {
  async listEvaluators(limit?: number, cursor?: string) {
    const params = new URLSearchParams();
    if (limit != null) {
      params.set('limit', String(limit));
    }
    if (cursor) {
      params.set('cursor', cursor);
    }
    const qs = params.toString();
    const url = qs.length > 0 ? `${evalBasePath}/evaluators?${qs}` : `${evalBasePath}/evaluators`;
    const response = await lastValueFrom(getBackendSrv().fetch<EvaluatorListResponse>({ method: 'GET', url }));
    return response.data;
  },

  async createEvaluator(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Evaluator>({
        method: 'POST',
        url: `${evalBasePath}/evaluators`,
        data: request,
      })
    );
    return response.data;
  },

  async getEvaluator(evaluatorID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Evaluator>({
        method: 'GET',
        url: `${evalBasePath}/evaluators/${encodeURIComponent(evaluatorID)}`,
      })
    );
    return response.data;
  },

  async deleteEvaluator(evaluatorID) {
    await lastValueFrom(
      getBackendSrv().fetch<void>({
        method: 'DELETE',
        url: `${evalBasePath}/evaluators/${encodeURIComponent(evaluatorID)}`,
      })
    );
  },

  async listPredefinedEvaluators() {
    const response = await lastValueFrom(
      getBackendSrv().fetch<EvaluatorListResponse>({
        method: 'GET',
        url: `${evalBasePath}/predefined/evaluators`,
      })
    );
    return response.data;
  },

  async forkPredefinedEvaluator(templateID, request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Evaluator>({
        method: 'POST',
        url: `${evalBasePath}/predefined/evaluators/${encodeURIComponent(templateID)}:fork`,
        data: request,
      })
    );
    return response.data;
  },

  async listRules(limit?: number, cursor?: string) {
    const params = new URLSearchParams();
    if (limit != null) {
      params.set('limit', String(limit));
    }
    if (cursor) {
      params.set('cursor', cursor);
    }
    const qs = params.toString();
    const url = qs.length > 0 ? `${evalBasePath}/rules?${qs}` : `${evalBasePath}/rules`;
    const response = await lastValueFrom(getBackendSrv().fetch<RuleListResponse>({ method: 'GET', url }));
    return response.data;
  },

  async createRule(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Rule>({
        method: 'POST',
        url: `${evalBasePath}/rules`,
        data: request,
      })
    );
    return response.data;
  },

  async getRule(ruleID) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Rule>({
        method: 'GET',
        url: `${evalBasePath}/rules/${encodeURIComponent(ruleID)}`,
      })
    );
    return response.data;
  },

  async updateRule(ruleID, request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Rule>({
        method: 'PATCH',
        url: `${evalBasePath}/rules/${encodeURIComponent(ruleID)}`,
        data: request,
      })
    );
    return response.data;
  },

  async deleteRule(ruleID) {
    await lastValueFrom(
      getBackendSrv().fetch<void>({
        method: 'DELETE',
        url: `${evalBasePath}/rules/${encodeURIComponent(ruleID)}`,
      })
    );
  },

  async previewRule(request) {
    const response = await lastValueFrom(
      getBackendSrv().fetch<RulePreviewResponse>({
        method: 'POST',
        url: `${evalBasePath}/rules:preview`,
        data: request,
      })
    );
    return response.data;
  },

  async listJudgeProviders() {
    const response = await lastValueFrom(
      getBackendSrv().fetch<JudgeProviderListResponse>({
        method: 'GET',
        url: `${evalBasePath}/judge/providers`,
      })
    );
    return response.data;
  },

  async listJudgeModels(provider) {
    const params = new URLSearchParams();
    params.set('provider', provider);
    const response = await lastValueFrom(
      getBackendSrv().fetch<JudgeModelListResponse>({
        method: 'GET',
        url: `${evalBasePath}/judge/models?${params.toString()}`,
      })
    );
    return response.data;
  },
};
