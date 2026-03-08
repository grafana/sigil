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
  description?: string;
  unit?: string;
  pass_threshold?: number;
  enum?: string[];
  min?: number;
  max?: number;
  pass_match?: string[];
  pass_value?: boolean;
};

export type OutputKeyFormInput = {
  key: string;
  type: ScoreType;
  description: string;
  enumValue: string;
  passThreshold: number | '';
  min: number | '';
  max: number | '';
  passMatch: string;
  passValue: 'true' | 'false' | '';
};

/** Build an EvalOutputKey from form state, applying trim and enum parsing. */
export function buildOutputKeyFromForm(input: OutputKeyFormInput): EvalOutputKey {
  const ok: EvalOutputKey = { key: input.key.trim() || 'score', type: input.type };
  if (input.description.trim()) {
    ok.description = input.description.trim();
  }
  if (input.type === 'string' && input.enumValue.trim()) {
    ok.enum = input.enumValue
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (input.type === 'number' && input.passThreshold !== '') {
    ok.pass_threshold = input.passThreshold;
  }
  if (input.type === 'number' && input.min !== '') {
    ok.min = input.min;
  }
  if (input.type === 'number' && input.max !== '') {
    ok.max = input.max;
  }
  if (input.type === 'string' && input.passMatch.trim()) {
    ok.pass_match = input.passMatch
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (input.type === 'bool' && input.passValue !== '') {
    ok.pass_value = input.passValue === 'true';
  }
  return ok;
}

/** Backend defaults applied when config fields are omitted. */
export const LLM_JUDGE_DEFAULT_SYSTEM_PROMPT =
  'You evaluate one assistant response. Use only the user input and assistant output. Follow the score field description exactly. Be strict. If uncertain, choose the lower score.';
export const LLM_JUDGE_DEFAULT_USER_PROMPT =
  'Latest user message:\n{{latest_user_message}}\n\nAssistant response:\n{{assistant_response}}';
export const LLM_JUDGE_USER_PROMPT_VARIABLES_DESCRIPTION =
  'Supports key variables like {{latest_user_message}}, {{assistant_response}}, {{system_prompt}}, {{tool_calls}}, {{tool_results}}, {{tools}}, {{assistant_sequence}}, {{stop_reason}}, and {{call_error}}. Check the online evaluation docs for the full variable list and rendering details. Uses the default prompt when blank.';

export function normalizedOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function getEffectiveLLMJudgePrompts(config: Record<string, unknown> | undefined): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: normalizedOptionalString(config?.system_prompt) ?? LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
    userPrompt: normalizedOptionalString(config?.user_prompt) ?? LLM_JUDGE_DEFAULT_USER_PROMPT,
  };
}

export function buildForkEvaluatorConfig(
  kind: EvaluatorKind,
  config: Record<string, unknown> | undefined
): Record<string, unknown> {
  const nextConfig = { ...(config ?? {}) };
  if (kind !== 'llm_judge') {
    return nextConfig;
  }

  if (normalizedOptionalString(nextConfig.system_prompt) == null) {
    nextConfig.system_prompt = LLM_JUDGE_DEFAULT_SYSTEM_PROMPT;
  }
  if (normalizedOptionalString(nextConfig.user_prompt) == null) {
    nextConfig.user_prompt = LLM_JUDGE_DEFAULT_USER_PROMPT;
  }
  return nextConfig;
}

export type Evaluator = {
  evaluator_id: string;
  version: string;
  kind: EvaluatorKind;
  description?: string;
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
  description?: string;
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
  enabled?: boolean;
  selector?: RuleSelector;
  match?: Record<string, string | string[]>;
  sample_rate?: number;
  evaluator_ids?: string[];
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

export type SavedConversation = {
  tenant_id: string;
  saved_id: string;
  conversation_id: string;
  name: string;
  source: 'telemetry' | 'manual';
  tags: Record<string, string>;
  saved_by: string;
  created_at: string;
  updated_at: string;
};

export type SavedConversationListResponse = {
  items: SavedConversation[];
  next_cursor: string;
};

export type SaveConversationRequest = {
  saved_id: string;
  conversation_id: string;
  name: string;
  tags?: Record<string, string>;
  saved_by: string;
};

export type CreateManualConversationRequest = {
  saved_id: string;
  name: string;
  tags?: Record<string, string>;
  saved_by: string;
  generations: ManualGeneration[];
};

export type ManualGeneration = {
  generation_id: string;
  operation_name: string;
  mode: 'SYNC' | 'STREAM';
  model: { provider: string; name: string };
  input: ManualMessage[];
  output: ManualMessage[];
  started_at?: string;
  completed_at?: string;
};

export type ManualMessage = {
  role: string;
  content: string;
};

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
