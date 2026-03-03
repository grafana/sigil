export type EvaluatorKind = 'llm_judge' | 'json_schema' | 'regex' | 'heuristic';

/** Shared state emitted by evaluator/template forms for the test panel. */
export type EvalFormState = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  outputKeys: EvalOutputKey[];
};

export type ScoreType = 'number' | 'bool' | 'string';

export type EvalOutputKey = {
  key: string;
  type: ScoreType;
  unit?: string;
  pass_threshold?: number;
};

export type Evaluator = {
  evaluator_id: string;
  version: string;
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
  is_predefined: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateEvaluatorRequest = {
  evaluator_id: string;
  version: string;
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
};

export type ForkEvaluatorRequest = {
  evaluator_id: string;
  version?: string;
  config?: Record<string, unknown>;
  output_keys?: EvalOutputKey[];
};

export type RuleSelector =
  | 'user_visible_turn'
  | 'all_assistant_generations'
  | 'tool_call_steps'
  | 'errored_generations';

export type Rule = {
  rule_id: string;
  enabled: boolean;
  selector: RuleSelector;
  match: Record<string, string | string[]>;
  sample_rate: number;
  evaluator_ids: string[];
  created_at: string;
  updated_at: string;
};

export type CreateRuleRequest = {
  rule_id: string;
  enabled?: boolean;
  selector?: RuleSelector;
  match?: Record<string, string | string[]>;
  sample_rate?: number;
  evaluator_ids: string[];
};

export type UpdateRuleRequest = {
  enabled: boolean;
};

export type JudgeProvider = {
  id: string;
  name: string;
  type: string;
};

export type JudgeModel = {
  id: string;
  name: string;
  provider: string;
  context_window?: number;
};

export type RulePreviewRequest = {
  rule_id?: string;
  selector: RuleSelector;
  match?: Record<string, string | string[]>;
  sample_rate?: number;
};

export type PreviewGenerationSample = {
  generation_id: string;
  conversation_id: string;
  agent_name?: string;
  model?: string;
  created_at: string;
  input_preview?: string;
};

export type RulePreviewResponse = {
  window_hours: number;
  total_generations: number;
  matching_generations: number;
  sampled_generations: number;
  samples: PreviewGenerationSample[];
};

export type EvaluatorListResponse = {
  items: Evaluator[];
  next_cursor: string;
};

export type RuleListResponse = {
  items: Rule[];
  next_cursor: string;
};

export type JudgeProviderListResponse = {
  providers: JudgeProvider[];
};

export type JudgeModelListResponse = {
  models: JudgeModel[];
};

export type EvalTestRequest = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
  generation_id: string;
};

export type EvalTestScore = {
  key: string;
  type: ScoreType;
  value: unknown;
  passed?: boolean;
  explanation?: string;
  metadata?: Record<string, unknown>;
};

export type EvalTestResponse = {
  generation_id: string;
  conversation_id: string;
  scores: EvalTestScore[];
  execution_time_ms: number;
};

export type TemplateScope = 'global' | 'tenant';

export type TemplateVersionSummary = {
  version: string;
  changelog: string;
  created_at: string;
};

export type TemplateDefinition = {
  tenant_id: string;
  template_id: string;
  scope: TemplateScope;
  kind: EvaluatorKind;
  description: string;
  latest_version: string;
  config?: Record<string, unknown>;
  output_keys?: EvalOutputKey[];
  versions: TemplateVersionSummary[];
  created_at: string;
  updated_at: string;
};

export type TemplateVersion = {
  tenant_id: string;
  template_id: string;
  version: string;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
  changelog: string;
  created_at: string;
};

export type CreateTemplateRequest = {
  template_id: string;
  kind: EvaluatorKind;
  description?: string;
  version: string;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
  changelog?: string;
};

export type PublishVersionRequest = {
  version: string;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
  changelog?: string;
};

export type ForkTemplateRequest = {
  evaluator_id: string;
  version?: string;
  config?: Record<string, unknown>;
  output_keys?: EvalOutputKey[];
};

export type TemplateListResponse = {
  items: TemplateDefinition[];
  next_cursor: string;
};

export type TemplateVersionListResponse = {
  items: TemplateVersion[];
};

export const SELECTOR_OPTIONS: Array<{ value: RuleSelector; label: string; description: string }> = [
  {
    value: 'user_visible_turn',
    label: 'User-visible turn',
    description: 'Assistant text output with no tool-call parts',
  },
  {
    value: 'all_assistant_generations',
    label: 'All assistant generations',
    description: 'Any generation with assistant output',
  },
  {
    value: 'tool_call_steps',
    label: 'Tool call steps',
    description: 'Generations containing tool-call parts',
  },
  {
    value: 'errored_generations',
    label: 'Errored generations',
    description: 'Generations with non-empty call error',
  },
];

export const MATCH_KEY_OPTIONS: Array<{ value: string; label: string; supportsGlob: boolean }> = [
  { value: 'agent_name', label: 'Agent name', supportsGlob: true },
  { value: 'agent_version', label: 'Agent version', supportsGlob: true },
  { value: 'operation_name', label: 'Operation name', supportsGlob: true },
  { value: 'model.provider', label: 'Model provider', supportsGlob: true },
  { value: 'model.name', label: 'Model name', supportsGlob: true },
  { value: 'mode', label: 'Mode', supportsGlob: false },
];

export const EVALUATOR_KIND_LABELS: Record<EvaluatorKind, string> = {
  llm_judge: 'LLM Judge',
  json_schema: 'JSON Schema',
  regex: 'Regex',
  heuristic: 'Heuristic',
};

export function formatEvaluatorId(id: string): string {
  if (id.startsWith('sigil.')) {
    return id.slice(6);
  }
  return id;
}

export function getKindBadgeColor(kind: EvaluatorKind): 'blue' | 'green' | 'orange' | 'purple' {
  switch (kind) {
    case 'llm_judge':
      return 'purple';
    case 'json_schema':
      return 'blue';
    case 'regex':
      return 'orange';
    case 'heuristic':
      return 'green';
    default:
      return 'blue';
  }
}
