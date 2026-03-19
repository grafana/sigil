import { type EvaluatorKind, type ScoreType, LLM_JUDGE_MIN_MAX_TOKENS, LLM_JUDGE_MAX_MAX_TOKENS } from './types';
import { validateHeuristicQuery, type HeuristicQueryGroup } from './heuristicConfig';

export type SharedInvalidField =
  | 'outputKey'
  | 'regexPattern'
  | 'judgeTarget'
  | 'maxTokens'
  | 'temperature'
  | 'schema'
  | 'heuristic'
  | 'passThreshold'
  | 'outputMax';

export type SharedFormValidationInput = {
  kind: EvaluatorKind;
  outputKey: string;
  provider: string;
  model: string;
  pattern: string;
  maxTokens: number;
  temperature: number;
  schemaJson: string;
  heuristicQuery?: HeuristicQueryGroup;
  output: {
    type: ScoreType;
    passThreshold: number | '';
    min: number | '';
    max: number | '';
  };
};

export type SharedFormValidationResult = {
  outputKeyError?: string;
  regexPatternError?: string;
  judgeTargetError?: string;
  maxTokensError?: string;
  temperatureError?: string;
  schemaParseError?: string;
  heuristicConfigError?: string;
  passThresholdError?: string;
  outputMaxError?: string;
  hasErrors: boolean;
  firstInvalidField: SharedInvalidField | null;
};

export function parseSchemaConfig(schemaJson: string): { schema: unknown } {
  try {
    return { schema: JSON.parse(schemaJson || '{}') };
  } catch {
    return { schema: {} };
  }
}

export function validateJudgeTarget(provider: string, model: string): string | undefined {
  const providerTrimmed = provider.trim();
  const modelTrimmed = model.trim();

  if (providerTrimmed === '' && modelTrimmed === '') {
    return undefined;
  }
  if (providerTrimmed !== '' && modelTrimmed === '') {
    return 'Choose both provider and model, or leave both blank';
  }
  if (providerTrimmed === '') {
    const slashIndex = modelTrimmed.indexOf('/');
    if (slashIndex > 0 && slashIndex < modelTrimmed.length - 1) {
      return undefined;
    }
    return 'Choose both provider and model, or use a fully-qualified model like provider/model';
  }
  return undefined;
}

export function validateSharedForm(input: SharedFormValidationInput): SharedFormValidationResult {
  const outputKeyError = input.outputKey.trim() === '' ? 'Output key is required' : undefined;
  const regexPatternError = input.kind === 'regex' && input.pattern.trim() === '' ? 'Pattern is required' : undefined;
  const judgeTargetError = input.kind === 'llm_judge' ? validateJudgeTarget(input.provider, input.model) : undefined;
  const maxTokensError =
    input.kind === 'llm_judge' &&
    (!Number.isInteger(input.maxTokens) ||
      input.maxTokens < LLM_JUDGE_MIN_MAX_TOKENS ||
      input.maxTokens > LLM_JUDGE_MAX_MAX_TOKENS)
      ? `Must be an integer between ${LLM_JUDGE_MIN_MAX_TOKENS} and ${LLM_JUDGE_MAX_MAX_TOKENS}`
      : undefined;
  const temperatureError =
    input.kind === 'llm_judge' &&
    (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
      ? 'Must be between 0 and 2'
      : undefined;

  let schemaParseError: string | undefined;
  if (input.kind === 'json_schema') {
    try {
      JSON.parse(input.schemaJson || '{}');
    } catch {
      schemaParseError = 'Invalid JSON';
    }
  }

  const heuristicConfigError =
    input.kind === 'heuristic'
      ? input.heuristicQuery == null
        ? 'Add at least one heuristic rule'
        : validateHeuristicQuery(input.heuristicQuery)
      : undefined;

  const passThresholdError =
    input.output.type === 'number' && input.output.passThreshold !== ''
      ? input.output.min !== '' && input.output.passThreshold < input.output.min
        ? 'Must be greater than or equal to Min'
        : input.output.max !== '' && input.output.passThreshold > input.output.max
          ? 'Must be less than or equal to Max'
          : undefined
      : undefined;

  const outputMaxError =
    input.output.type === 'number' &&
    input.output.min !== '' &&
    input.output.max !== '' &&
    input.output.min >= input.output.max
      ? 'Must be greater than Min'
      : undefined;

  const firstInvalidField: SharedInvalidField | null = outputKeyError
    ? 'outputKey'
    : regexPatternError
      ? 'regexPattern'
      : judgeTargetError
        ? 'judgeTarget'
        : maxTokensError
          ? 'maxTokens'
          : temperatureError
            ? 'temperature'
            : schemaParseError
              ? 'schema'
              : heuristicConfigError
                ? 'heuristic'
                : passThresholdError
                  ? 'passThreshold'
                  : outputMaxError
                    ? 'outputMax'
                    : null;

  return {
    outputKeyError,
    regexPatternError,
    judgeTargetError,
    maxTokensError,
    temperatureError,
    schemaParseError,
    heuristicConfigError,
    passThresholdError,
    outputMaxError,
    hasErrors: firstInvalidField != null,
    firstInvalidField,
  };
}
