import type { EvaluatorKind, ScoreType } from './types';
import { parseHeuristicStringListInput } from './heuristicConfig';

export type SharedInvalidField =
  | 'outputKey'
  | 'regexPattern'
  | 'maxTokens'
  | 'temperature'
  | 'schema'
  | 'heuristic'
  | 'heuristicMaxLength'
  | 'passThreshold'
  | 'outputMax';

export type SharedFormValidationInput = {
  kind: EvaluatorKind;
  outputKey: string;
  pattern: string;
  maxTokens: number;
  temperature: number;
  schemaJson: string;
  heuristic: {
    notEmpty: boolean;
    contains: string;
    notContains: string;
    minLength: number | '';
    maxLength: number | '';
  };
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
  maxTokensError?: string;
  temperatureError?: string;
  schemaParseError?: string;
  heuristicConfigError?: string;
  heuristicMaxLengthError?: string;
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

export function validateSharedForm(input: SharedFormValidationInput): SharedFormValidationResult {
  const outputKeyError = input.outputKey.trim() === '' ? 'Output key is required' : undefined;
  const regexPatternError = input.kind === 'regex' && input.pattern.trim() === '' ? 'Pattern is required' : undefined;
  const maxTokensError =
    input.kind === 'llm_judge' && (!Number.isInteger(input.maxTokens) || input.maxTokens < 1)
      ? 'Must be an integer greater than 0'
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
    input.kind === 'heuristic' &&
    !input.heuristic.notEmpty &&
    parseHeuristicStringListInput(input.heuristic.contains) == null &&
    parseHeuristicStringListInput(input.heuristic.notContains) == null &&
    input.heuristic.minLength === '' &&
    input.heuristic.maxLength === ''
      ? 'Add at least one heuristic rule'
      : undefined;

  const heuristicMaxLengthError =
    input.kind === 'heuristic' &&
    input.heuristic.minLength !== '' &&
    input.heuristic.maxLength !== '' &&
    Number(input.heuristic.minLength) >= Number(input.heuristic.maxLength)
      ? 'Must be greater than Min length'
      : undefined;

  const passThresholdError =
    input.output.type === 'number' &&
    input.output.passThreshold !== '' &&
    input.output.min !== '' &&
    input.output.passThreshold < input.output.min
      ? 'Must be greater than or equal to Min'
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
      : maxTokensError
        ? 'maxTokens'
        : temperatureError
          ? 'temperature'
          : schemaParseError
            ? 'schema'
            : heuristicConfigError
              ? 'heuristic'
              : heuristicMaxLengthError
                ? 'heuristicMaxLength'
                : passThresholdError
                  ? 'passThreshold'
                  : outputMaxError
                    ? 'outputMax'
                    : null;

  return {
    outputKeyError,
    regexPatternError,
    maxTokensError,
    temperatureError,
    schemaParseError,
    heuristicConfigError,
    heuristicMaxLengthError,
    passThresholdError,
    outputMaxError,
    hasErrors: firstInvalidField != null,
    firstInvalidField,
  };
}
