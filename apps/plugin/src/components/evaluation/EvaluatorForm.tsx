import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, Input, Select, Stack, Switch, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  EVALUATOR_KIND_LABELS,
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  buildOutputKeyFromForm,
  normalizedOptionalString,
  type CreateEvaluatorRequest,
  type EvalFormState,
  type EvalOutputKey,
  type Evaluator,
  type EvaluatorKind,
  type ScoreType,
} from '../../evaluation/types';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import { focusFirstInvalidField, focusInvalidFieldFromMap } from '../../evaluation/focusFirstInvalid';
import { parseSchemaConfig, validateSharedForm } from '../../evaluation/formValidation';
import { formatHeuristicStringList, parseHeuristicStringListInput } from '../../evaluation/heuristicConfig';
import { isValidResourceID, INVALID_ID_MESSAGE } from '../../evaluation/utils';
import { nextVersion } from '../../evaluation/versionUtils';
import JudgeProviderModelFields from './JudgeProviderModelFields';
import { getSectionTitleStyles } from './sectionStyles';
import PromptTemplateTextarea from './PromptTemplateTextarea';

export type EvaluatorFormProps = {
  initialEvaluator?: Evaluator;
  /** Pre-fill the form in create mode (e.g. when forking a template). */
  prefill?: Partial<Evaluator>;
  /** When editing, pass existing versions so the form suggests a new unique version. */
  existingVersions?: string[];
  onSubmit: (req: CreateEvaluatorRequest) => void;
  onCancel: () => void;
  onConfigChange?: (state: EvalFormState) => void;
  dataSource?: EvaluationDataSource;
};

const KIND_OPTIONS: Array<SelectableValue<EvaluatorKind>> = (
  ['llm_judge', 'json_schema', 'regex', 'heuristic'] as const
).map((k) => ({ label: EVALUATOR_KIND_LABELS[k], value: k }));

const SCORE_TYPE_OPTIONS: Array<SelectableValue<ScoreType>> = [
  { label: 'number', value: 'number' },
  { label: 'bool', value: 'bool' },
  { label: 'string', value: 'string' },
];

const getStyles = (theme: GrafanaTheme2) => ({
  form: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.25),
  }),
  section: css({
    margin: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    background: theme.colors.background.primary,
    flexShrink: 0,
    padding: theme.spacing(0.75, 1.25, 0.25),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  sectionTitle: css({
    ...getSectionTitleStyles(theme),
  }),
  sectionBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.25),
    padding: theme.spacing(1, 1.25),
    '& > *': {
      margin: '0 !important',
    },
  }),
  twoColumnGrid: css({
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: theme.spacing(1.25),
    alignItems: 'start',
    '& > *': {
      margin: '0 !important',
    },
  }),
  fullWidthControl: css({
    width: '100% !important',
    minWidth: 0,
  }),
  compactControl: css({
    width: '100% !important',
    maxWidth: 320,
    minWidth: 0,
  }),
  numericControl: css({
    width: '100% !important',
    maxWidth: 180,
    minWidth: 0,
  }),
  textarea: css({
    width: '100%',
    minHeight: 180,
    padding: theme.spacing(1, 2),
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.canvas,
    color: theme.colors.text.primary,
    resize: 'vertical' as const,
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary.border,
    },
  }),
  codeTextarea: css({
    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
  }),
  descriptionTextarea: css({
    minHeight: 80,
  }),
  switchField: css({
    minHeight: theme.spacing(7),
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
  }),
  sectionText: css({
    marginBottom: theme.spacing(0.25),
  }),
  validationMessage: css({
    marginTop: theme.spacing(0.25),
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-start',
    paddingTop: theme.spacing(0.75),
  }),
});

function parseEvaluatorToFormState(
  e: Partial<Evaluator>,
  existingVersions?: string[]
): {
  evaluatorId: string;
  version: string;
  kind: EvaluatorKind;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  schemaJson: string;
  pattern: string;
  notEmpty: boolean;
  contains: string;
  notContains: string;
  minLength: number | '';
  maxLength: number | '';
  outputKey: string;
  outputType: ScoreType;
  outputDescription: string;
  outputEnum: string;
  passThreshold: number | '';
  outputMin: number | '';
  outputMax: number | '';
  passMatch: string;
  passValue: 'true' | 'false' | '';
} {
  const cfg = e.config ?? {};
  const firstOk = e.output_keys?.[0];
  const versionsToAvoid = existingVersions ?? (e.version ? [e.version] : []);
  return {
    evaluatorId: e.evaluator_id ?? '',
    version: nextVersion(versionsToAvoid.length > 0 ? versionsToAvoid : undefined),
    kind: e.kind ?? 'llm_judge',
    description: e.description ?? '',
    systemPrompt: normalizedOptionalString(cfg.system_prompt) ?? '',
    userPrompt: normalizedOptionalString(cfg.user_prompt) ?? '',
    maxTokens: (cfg.max_tokens as number) ?? 128,
    temperature: (cfg.temperature as number) ?? 0,
    schemaJson: typeof cfg.schema === 'object' ? JSON.stringify(cfg.schema, null, 2) : '{}',
    pattern: (cfg.pattern as string) ?? '',
    notEmpty: (cfg.not_empty as boolean) ?? false,
    contains: formatHeuristicStringList(cfg.contains),
    notContains: formatHeuristicStringList(cfg.not_contains),
    minLength: cfg.min_length != null ? (cfg.min_length as number) : '',
    maxLength: cfg.max_length != null ? (cfg.max_length as number) : '',
    outputKey: firstOk?.key ?? 'score',
    outputType: (firstOk?.type as ScoreType) ?? 'number',
    outputDescription: firstOk?.description ?? '',
    outputEnum: firstOk?.enum?.join(', ') ?? '',
    passThreshold: firstOk?.pass_threshold ?? '',
    outputMin: firstOk?.min ?? '',
    outputMax: firstOk?.max ?? '',
    passMatch: firstOk?.pass_match?.join(', ') ?? '',
    passValue: firstOk?.pass_value != null ? (firstOk.pass_value ? 'true' : 'false') : '',
  };
}

export default function EvaluatorForm({
  initialEvaluator,
  prefill,
  existingVersions,
  onSubmit,
  onCancel,
  onConfigChange,
  dataSource,
}: EvaluatorFormProps) {
  const styles = useStyles2(getStyles);
  const ds = dataSource ?? defaultEvaluationDataSource;
  const isEdit = initialEvaluator != null;
  const seedEvaluator = initialEvaluator ?? prefill;
  const initialState = useMemo(
    () => (seedEvaluator != null ? parseEvaluatorToFormState(seedEvaluator, existingVersions) : null),
    // Only needed for initial mount; seedEvaluator/existingVersions are stable for the component lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [evaluatorId, setEvaluatorId] = useState(() => initialState?.evaluatorId ?? '');
  const [version, setVersion] = useState(() => initialState?.version ?? nextVersion());
  const [kind, setKind] = useState<EvaluatorKind>(initialState?.kind ?? 'llm_judge');
  const [description, setDescription] = useState(() => initialState?.description ?? '');
  const [touched, setTouched] = useState(false);

  // llm_judge: provider, model, system_prompt, user_prompt, max_tokens, temperature
  const [provider, setProvider] = useState(() => {
    const cfg = seedEvaluator?.config;
    return normalizedOptionalString(cfg?.provider) ?? '';
  });
  const [model, setModel] = useState(() => {
    const cfg = seedEvaluator?.config;
    return normalizedOptionalString(cfg?.model) ?? '';
  });
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [systemPrompt, setSystemPrompt] = useState(initialState?.systemPrompt ?? '');
  const [userPrompt, setUserPrompt] = useState(initialState?.userPrompt ?? '');
  const [maxTokens, setMaxTokens] = useState(initialState?.maxTokens ?? 128);
  const [temperature, setTemperature] = useState(initialState?.temperature ?? 0);

  // Load judge providers on mount
  useEffect(() => {
    void ds
      .listJudgeProviders()
      .then((res) => {
        setProviderOptions(res.providers.map((p) => ({ label: p.name, value: p.id })));
      })
      .catch(() => {});
  }, [ds]);

  // Load models when provider changes
  useEffect(() => {
    if (!provider) {
      setModelOptions([]);
      return;
    }
    void ds
      .listJudgeModels(provider)
      .then((res) => {
        setModelOptions(res.models.map((m) => ({ label: m.name, value: m.id })));
      })
      .catch(() => {});
  }, [ds, provider]);

  // json_schema: schema
  const [schemaJson, setSchemaJson] = useState(initialState?.schemaJson ?? '{}');

  // regex: pattern
  const [pattern, setPattern] = useState(initialState?.pattern ?? '');

  // heuristic: not_empty, contains, not_contains, min_length, max_length
  const [notEmpty, setNotEmpty] = useState(initialState?.notEmpty ?? false);
  const [contains, setContains] = useState(initialState?.contains ?? '');
  const [notContains, setNotContains] = useState(initialState?.notContains ?? '');
  const [minLength, setMinLength] = useState<number | ''>(initialState?.minLength ?? '');
  const [maxLength, setMaxLength] = useState<number | ''>(initialState?.maxLength ?? '');

  // output key
  const [outputKey, setOutputKey] = useState(initialState?.outputKey ?? 'score');
  const [outputType, setOutputType] = useState<ScoreType>(initialState?.outputType ?? 'number');
  const [outputDescription, setOutputDescription] = useState(initialState?.outputDescription ?? '');
  const [outputEnum, setOutputEnum] = useState(initialState?.outputEnum ?? '');
  const [passThreshold, setPassThreshold] = useState<number | ''>(initialState?.passThreshold ?? '');
  const [outputMin, setOutputMin] = useState<number | ''>(initialState?.outputMin ?? '');
  const [outputMax, setOutputMax] = useState<number | ''>(initialState?.outputMax ?? '');
  const [passMatch, setPassMatch] = useState(initialState?.passMatch ?? '');
  const [passValue, setPassValue] = useState<'true' | 'false' | ''>(initialState?.passValue ?? '');
  const evaluatorIdFieldRef = useRef<HTMLDivElement>(null);
  const outputKeyFieldRef = useRef<HTMLDivElement>(null);
  const regexPatternFieldRef = useRef<HTMLDivElement>(null);
  const maxTokensFieldRef = useRef<HTMLDivElement>(null);
  const temperatureFieldRef = useRef<HTMLDivElement>(null);
  const schemaFieldRef = useRef<HTMLDivElement>(null);
  const heuristicFieldRef = useRef<HTMLDivElement>(null);
  const heuristicMaxLengthFieldRef = useRef<HTMLDivElement>(null);
  const passThresholdFieldRef = useRef<HTMLDivElement>(null);
  const outputMaxFieldRef = useRef<HTMLDivElement>(null);

  const prevExistingVersionsKey = useRef<string>('');

  useEffect(() => {
    if (!isEdit || existingVersions == null) {
      return;
    }
    const key = existingVersions.join(',');
    if (prevExistingVersionsKey.current !== key) {
      prevExistingVersionsKey.current = key;
      setVersion(nextVersion(existingVersions));
    }
  }, [isEdit, existingVersions]);

  const buildConfig = (): Record<string, unknown> => {
    switch (kind) {
      case 'llm_judge':
        return {
          provider: normalizedOptionalString(provider),
          model: normalizedOptionalString(model),
          system_prompt: normalizedOptionalString(systemPrompt),
          user_prompt: normalizedOptionalString(userPrompt),
          max_tokens: maxTokens,
          temperature: temperature,
        };
      case 'json_schema':
        return parseSchemaConfig(schemaJson);
      case 'regex':
        return { pattern: pattern || '' };
      case 'heuristic':
        return {
          not_empty: notEmpty,
          contains: parseHeuristicStringListInput(contains),
          not_contains: parseHeuristicStringListInput(notContains),
          min_length: minLength === '' ? undefined : minLength,
          max_length: maxLength === '' ? undefined : maxLength,
        };
      default:
        return {};
    }
  };

  useEffect(() => {
    onConfigChange?.({
      kind,
      config: buildConfig(),
      outputKeys: [
        buildOutputKeyFromForm({
          key: outputKey,
          type: outputType,
          description: outputDescription,
          enumValue: outputEnum,
          passThreshold,
          min: outputMin,
          max: outputMax,
          passMatch,
          passValue,
        }),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    kind,
    provider,
    model,
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature,
    schemaJson,
    pattern,
    notEmpty,
    contains,
    notContains,
    minLength,
    maxLength,
    outputKey,
    outputType,
    outputDescription,
    outputEnum,
    passThreshold,
    outputMin,
    outputMax,
    passMatch,
    passValue,
  ]);

  const isIdEmpty = evaluatorId.trim() === '';
  const isIdInvalid = !isIdEmpty && !isValidResourceID(evaluatorId.trim());
  const idError = isIdEmpty ? 'Evaluator ID is required' : isIdInvalid ? INVALID_ID_MESSAGE : undefined;
  const sharedValidation = validateSharedForm({
    kind,
    outputKey,
    pattern,
    maxTokens,
    temperature,
    schemaJson,
    heuristic: {
      notEmpty,
      contains,
      notContains,
      minLength,
      maxLength,
    },
    output: {
      type: outputType,
      passThreshold,
      min: outputMin,
      max: outputMax,
    },
  });
  const outputKeyError = sharedValidation.outputKeyError;
  const regexPatternError = sharedValidation.regexPatternError;
  const maxTokensError = sharedValidation.maxTokensError;
  const temperatureError = sharedValidation.temperatureError;
  const schemaParseError = sharedValidation.schemaParseError ?? '';
  const heuristicConfigError = sharedValidation.heuristicConfigError;
  const heuristicMaxLengthError = sharedValidation.heuristicMaxLengthError;
  const passThresholdError = sharedValidation.passThresholdError;
  const outputMaxError = sharedValidation.outputMaxError;
  const showIdError = touched && (isIdEmpty || isIdInvalid);
  const showOutputKeyError = touched && outputKeyError != null;
  const showRegexPatternError = touched && regexPatternError != null;
  const showMaxTokensError = touched && maxTokensError != null;
  const showTemperatureError = touched && temperatureError != null;
  const showSchemaError = touched && schemaParseError !== '';
  const showHeuristicConfigError = touched && heuristicConfigError != null;
  const showHeuristicMaxLengthError = touched && heuristicMaxLengthError != null;
  const showPassThresholdError = touched && passThresholdError != null;
  const showOutputMaxError = touched && outputMaxError != null;

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty || isIdInvalid || sharedValidation.hasErrors) {
      if (isIdEmpty || isIdInvalid) {
        focusFirstInvalidField(evaluatorIdFieldRef.current);
      } else {
        focusInvalidFieldFromMap(sharedValidation.firstInvalidField, {
          outputKey: outputKeyFieldRef.current,
          regexPattern: regexPatternFieldRef.current,
          maxTokens: maxTokensFieldRef.current,
          temperature: temperatureFieldRef.current,
          schema: schemaFieldRef.current,
          heuristic: heuristicFieldRef.current,
          heuristicMaxLength: heuristicMaxLengthFieldRef.current,
          passThreshold: passThresholdFieldRef.current,
          outputMax: outputMaxFieldRef.current,
        });
      }
      return;
    }

    const outputKeys: EvalOutputKey[] = [
      buildOutputKeyFromForm({
        key: outputKey,
        type: outputType,
        description: outputDescription,
        enumValue: outputEnum,
        passThreshold,
        min: outputMin,
        max: outputMax,
        passMatch,
        passValue,
      }),
    ];

    const req: CreateEvaluatorRequest = {
      evaluator_id: evaluatorId.trim(),
      version: version.trim() || nextVersion(),
      kind,
      description: description.trim() || undefined,
      config: buildConfig(),
      output_keys: outputKeys,
    };
    onSubmit(req);
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Basics</div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.sectionText}>
            <Text variant="body" color="secondary">
              Set the evaluator identity and describe what this evaluator measures.
            </Text>
          </div>
          <div className={styles.twoColumnGrid}>
            <Field label="Evaluator ID" description="Unique identifier for this evaluator." required>
              <div ref={evaluatorIdFieldRef}>
                <Input
                  className={styles.compactControl}
                  value={evaluatorId}
                  onChange={(e) => setEvaluatorId(e.currentTarget.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="e.g. custom.helpfulness"
                  disabled={isEdit}
                />
                {showIdError && idError && (
                  <div className={styles.validationMessage}>
                    <Text variant="bodySmall" color="error">
                      {idError}
                    </Text>
                  </div>
                )}
              </div>
            </Field>
            <Field label="Kind" description="Select how this evaluator scores a generation.">
              <Select<EvaluatorKind>
                className={styles.compactControl}
                options={KIND_OPTIONS}
                value={kind}
                onChange={(v) => {
                  if (v?.value) {
                    setKind(v.value);
                  }
                }}
              />
            </Field>
          </div>
          <Field label="Description" description="Optional summary shown alongside this evaluator.">
            <textarea
              className={`${styles.textarea} ${styles.descriptionTextarea}`}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="e.g. Checks whether the response is helpful and grounded in the user request."
              rows={3}
            />
          </Field>
        </div>
      </div>

      {kind === 'llm_judge' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Judge configuration</div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionText}>
              <Text variant="body" color="secondary">
                Choose the judge model and define the prompts and settings used to score each generation.
              </Text>
            </div>
            <div className={styles.twoColumnGrid}>
              <JudgeProviderModelFields
                compactControlClassName={styles.compactControl}
                provider={provider}
                model={model}
                providerOptions={providerOptions}
                modelOptions={modelOptions}
                setProvider={setProvider}
                setModel={setModel}
                setModelOptions={setModelOptions}
              />
            </div>
            <Field
              label="System prompt"
              description="Optional. Instructions for the judge model. Uses the default prompt when blank."
            >
              <PromptTemplateTextarea
                value={systemPrompt}
                onChange={setSystemPrompt}
                placeholder={LLM_JUDGE_DEFAULT_SYSTEM_PROMPT}
              />
            </Field>
            <Field
              label="User prompt"
              description="Optional. Supports {{input}}, {{output}}, {{generation_id}}, {{conversation_id}}. Uses the default prompt when blank."
            >
              <PromptTemplateTextarea
                value={userPrompt}
                onChange={setUserPrompt}
                placeholder={LLM_JUDGE_DEFAULT_USER_PROMPT}
              />
            </Field>
            <div className={styles.twoColumnGrid}>
              <Field label="Max tokens">
                <div ref={maxTokensFieldRef}>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.currentTarget.value, 10) || 0)}
                  />
                  {showMaxTokensError && maxTokensError && (
                    <div className={styles.validationMessage}>
                      <Text variant="bodySmall" color="error">
                        {maxTokensError}
                      </Text>
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Temperature">
                <div ref={temperatureFieldRef}>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.currentTarget.value) || 0)}
                  />
                  {showTemperatureError && temperatureError && (
                    <div className={styles.validationMessage}>
                      <Text variant="bodySmall" color="error">
                        {temperatureError}
                      </Text>
                    </div>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      )}

      {kind === 'json_schema' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Schema configuration</div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionText}>
              <Text variant="body" color="secondary">
                Provide the JSON schema used to validate each generation result.
              </Text>
            </div>
            <Field label="Schema" description="Optional. JSON schema for validation. Leave blank to use {}.">
              <div ref={schemaFieldRef}>
                <textarea
                  className={`${styles.textarea} ${styles.codeTextarea}`}
                  value={schemaJson}
                  onChange={(e) => setSchemaJson(e.currentTarget.value)}
                  placeholder='{"type": "object", "properties": {...}}'
                  rows={6}
                />
                {showSchemaError && (
                  <div className={styles.validationMessage}>
                    <Text variant="bodySmall" color="error">
                      {schemaParseError}
                    </Text>
                  </div>
                )}
              </div>
            </Field>
          </div>
        </div>
      )}

      {kind === 'regex' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Regex configuration</div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionText}>
              <Text variant="body" color="secondary">
                Provide the pattern used to check each generation result.
              </Text>
            </div>
            <Field label="Pattern" description="Regex pattern to match.">
              <div ref={regexPatternFieldRef}>
                <Input
                  className={styles.compactControl}
                  value={pattern}
                  onChange={(e) => setPattern(e.currentTarget.value)}
                  placeholder="e.g. ^[A-Z].*"
                />
                {showRegexPatternError && regexPatternError && (
                  <div className={styles.validationMessage}>
                    <Text variant="bodySmall" color="error">
                      {regexPatternError}
                    </Text>
                  </div>
                )}
              </div>
            </Field>
          </div>
        </div>
      )}

      {kind === 'heuristic' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Heuristic configuration</div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionText}>
              <Text variant="body" color="secondary">
                Define the simple rules used to check presence and length for each generation result.
              </Text>
            </div>
            {showHeuristicConfigError && heuristicConfigError && (
              <div className={styles.validationMessage}>
                <Text variant="bodySmall" color="error">
                  {heuristicConfigError}
                </Text>
              </div>
            )}
            <Field className={styles.switchField} label="Not empty" description="Optional. Require non-empty output.">
              <div ref={heuristicFieldRef}>
                <Switch value={notEmpty} onChange={(e) => setNotEmpty(e.currentTarget.checked)} />
              </div>
            </Field>
            <Field label="Contains" description="Optional. Require each phrase to appear. Use one phrase per line.">
              <textarea
                className={`${styles.textarea} ${styles.descriptionTextarea}`}
                value={contains}
                onChange={(e) => setContains(e.currentTarget.value)}
                placeholder={'e.g. refund requested\naccount issue'}
                rows={3}
              />
            </Field>
            <Field
              label="Not contains"
              description="Optional. Reject output if any phrase appears. Use one phrase per line."
            >
              <textarea
                className={`${styles.textarea} ${styles.descriptionTextarea}`}
                value={notContains}
                onChange={(e) => setNotContains(e.currentTarget.value)}
                placeholder={'e.g. profanity\nunsafe advice'}
                rows={3}
              />
            </Field>
            <div className={styles.twoColumnGrid}>
              <Field label="Min length" description="Optional. Minimum response length.">
                <Input
                  className={styles.numericControl}
                  type="number"
                  value={minLength}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setMinLength(v === '' ? '' : parseInt(v, 10) || 0);
                  }}
                  placeholder="e.g. 0"
                />
              </Field>
              <Field label="Max length" description="Optional. Maximum response length.">
                <div ref={heuristicMaxLengthFieldRef}>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={maxLength}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setMaxLength(v === '' ? '' : parseInt(v, 10) || 0);
                    }}
                    placeholder="e.g. 100"
                  />
                  {showHeuristicMaxLengthError && heuristicMaxLengthError && (
                    <div className={styles.validationMessage}>
                      <Text variant="bodySmall" color="error">
                        {heuristicMaxLengthError}
                      </Text>
                    </div>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Output</div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.sectionText}>
            <Text variant="body" color="secondary">
              Define the score this evaluator emits and how downstream views should interpret it.
            </Text>
          </div>
          <div className={styles.twoColumnGrid}>
            <Field label="Output key">
              <div ref={outputKeyFieldRef}>
                <Input
                  className={styles.compactControl}
                  value={outputKey}
                  onChange={(e) => setOutputKey(e.currentTarget.value)}
                  placeholder="score"
                />
                {showOutputKeyError && outputKeyError && (
                  <div className={styles.validationMessage}>
                    <Text variant="bodySmall" color="error">
                      {outputKeyError}
                    </Text>
                  </div>
                )}
              </div>
            </Field>
            <Field label="Output type">
              <Select<ScoreType>
                className={styles.compactControl}
                options={SCORE_TYPE_OPTIONS}
                value={outputType}
                onChange={(v) => {
                  if (v?.value) {
                    setOutputType(v.value);
                  }
                }}
              />
            </Field>
          </div>
          <Field
            label="Output description"
            description={
              kind === 'llm_judge'
                ? 'Optional. Included in the LLM Judge prompt to guide scoring.'
                : 'Optional. Metadata for the output key.'
            }
          >
            <Input
              className={styles.fullWidthControl}
              value={outputDescription}
              onChange={(e) => setOutputDescription(e.currentTarget.value)}
              placeholder="e.g. How helpful the response is on a 1-10 scale"
            />
          </Field>
          {kind === 'llm_judge' && outputType === 'string' && (
            <Field
              label="Allowed values"
              description="Optional. Comma-separated list of allowed string values. Enforced via structured output."
            >
              <Input
                className={styles.fullWidthControl}
                value={outputEnum}
                onChange={(e) => setOutputEnum(e.currentTarget.value)}
                placeholder="e.g. none, mild, moderate, severe"
              />
            </Field>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Pass conditions</div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.sectionText}>
            <Text variant="body" color="secondary">
              Define which output values should count as passing for this evaluator.
            </Text>
          </div>
          {outputType === 'number' && (
            <div className={styles.twoColumnGrid}>
              <Field label="Pass threshold" description="Optional. Score at or above this value passes.">
                <div ref={passThresholdFieldRef}>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={passThreshold}
                    onChange={(e) =>
                      setPassThreshold(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))
                    }
                    placeholder="e.g. 5"
                  />
                  {showPassThresholdError && passThresholdError && (
                    <div className={styles.validationMessage}>
                      <Text variant="bodySmall" color="error">
                        {passThresholdError}
                      </Text>
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Min" description="Optional. Lowest expected score value.">
                <Input
                  className={styles.numericControl}
                  type="number"
                  value={outputMin}
                  onChange={(e) => setOutputMin(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
                  placeholder="e.g. 1"
                />
              </Field>
              <Field label="Max" description="Optional. Highest expected score value.">
                <div ref={outputMaxFieldRef}>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={outputMax}
                    onChange={(e) => setOutputMax(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
                    placeholder="e.g. 10"
                  />
                  {showOutputMaxError && outputMaxError && (
                    <div className={styles.validationMessage}>
                      <Text variant="bodySmall" color="error">
                        {outputMaxError}
                      </Text>
                    </div>
                  )}
                </div>
              </Field>
            </div>
          )}
          {outputType === 'string' && (
            <Field label="Pass values" description="Optional. Comma-separated values that count as passing.">
              <Input
                className={styles.fullWidthControl}
                value={passMatch}
                onChange={(e) => setPassMatch(e.currentTarget.value)}
                placeholder="e.g. none, mild"
              />
            </Field>
          )}
          {outputType === 'bool' && (
            <Field label="Pass when" description="Optional. Choose which boolean value counts as passing.">
              <Select<string>
                className={styles.compactControl}
                options={[
                  { label: 'true (default)', value: '' },
                  { label: 'true', value: 'true' },
                  { label: 'false', value: 'false' },
                ]}
                value={passValue}
                onChange={(v) => setPassValue((v?.value ?? '') as 'true' | 'false' | '')}
              />
            </Field>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <Stack direction="row" gap={1}>
          <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Create'}</Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </Stack>
      </div>
    </div>
  );
}
