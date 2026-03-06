import React, { useEffect, useRef, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, Input, Select, Stack, Switch, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  buildOutputKeyFromForm,
  normalizedOptionalString,
  type EvalFormState,
  type EvalOutputKey,
  type EvaluatorKind,
  type PublishVersionRequest,
  type ScoreType,
} from '../../evaluation/types';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import { focusInvalidFieldFromMap } from '../../evaluation/focusFirstInvalid';
import { parseSchemaConfig, validateSharedForm } from '../../evaluation/formValidation';
import { formatHeuristicStringList, parseHeuristicStringListInput } from '../../evaluation/heuristicConfig';
import { nextVersion } from '../../evaluation/versionUtils';
import JudgeProviderModelFields from './JudgeProviderModelFields';
import { getSectionTitleStyles } from './sectionStyles';
import PromptTemplateTextarea from './PromptTemplateTextarea';

export type PublishVersionFormProps = {
  kind: EvaluatorKind;
  initialConfig?: Record<string, unknown>;
  initialOutputKeys?: EvalOutputKey[];
  existingVersions?: string[];
  onSubmit: (req: PublishVersionRequest) => void;
  onCancel: () => void;
  onConfigChange?: (state: EvalFormState) => void;
  dataSource?: EvaluationDataSource;
};

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
  sectionText: css({
    marginBottom: theme.spacing(0.25),
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
  validationMessage: css({
    marginTop: theme.spacing(0.25),
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-start',
    paddingTop: theme.spacing(0.25),
  }),
});

export default function PublishVersionForm({
  kind,
  initialConfig,
  initialOutputKeys,
  existingVersions,
  onSubmit,
  onCancel,
  onConfigChange,
  dataSource,
}: PublishVersionFormProps) {
  const styles = useStyles2(getStyles);
  const ds = dataSource ?? defaultEvaluationDataSource;

  const [version] = useState(() => nextVersion(existingVersions));
  const [touched, setTouched] = useState(false);

  const [provider, setProvider] = useState(() => normalizedOptionalString(initialConfig?.provider) ?? '');
  const [model, setModel] = useState(() => normalizedOptionalString(initialConfig?.model) ?? '');
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [systemPrompt, setSystemPrompt] = useState(() => normalizedOptionalString(initialConfig?.system_prompt) ?? '');
  const [userPrompt, setUserPrompt] = useState(() => normalizedOptionalString(initialConfig?.user_prompt) ?? '');
  const [maxTokens, setMaxTokens] = useState(() => {
    const v = initialConfig?.max_tokens;
    return typeof v === 'number' ? v : 128;
  });
  const [temperature, setTemperature] = useState(() => {
    const v = initialConfig?.temperature;
    return typeof v === 'number' ? v : 0;
  });

  const [schemaJson, setSchemaJson] = useState(() => {
    const s = initialConfig?.schema;
    return s ? JSON.stringify(s, null, 2) : '{}';
  });
  const [pattern, setPattern] = useState(() => String(initialConfig?.pattern ?? ''));
  const [notEmpty, setNotEmpty] = useState(() => Boolean(initialConfig?.not_empty));
  const [contains, setContains] = useState(() => formatHeuristicStringList(initialConfig?.contains));
  const [notContains, setNotContains] = useState(() => formatHeuristicStringList(initialConfig?.not_contains));
  const [heuristicMinLength, setHeuristicMinLength] = useState<number | ''>(() => {
    const v = initialConfig?.min_length;
    return typeof v === 'number' ? v : '';
  });
  const [heuristicMaxLength, setHeuristicMaxLength] = useState<number | ''>(() => {
    const v = initialConfig?.max_length;
    return typeof v === 'number' ? v : '';
  });

  useEffect(() => {
    if (kind !== 'llm_judge') {
      return;
    }
    void ds
      .listJudgeProviders()
      .then((res) => {
        setProviderOptions(res.providers.map((p) => ({ label: p.name, value: p.id })));
      })
      .catch(() => {});
  }, [ds, kind]);

  useEffect(() => {
    if (kind !== 'llm_judge' || !provider) {
      setModelOptions([]);
      return;
    }
    void ds
      .listJudgeModels(provider)
      .then((res) => {
        setModelOptions(res.models.map((m) => ({ label: m.name, value: m.id })));
      })
      .catch(() => {});
  }, [ds, kind, provider]);

  const [outputKey, setOutputKey] = useState(initialOutputKeys?.[0]?.key ?? 'score');
  const [outputType, setOutputType] = useState<ScoreType>(initialOutputKeys?.[0]?.type ?? 'number');
  const [outputDescription, setOutputDescription] = useState(initialOutputKeys?.[0]?.description ?? '');
  const [outputEnum, setOutputEnum] = useState(initialOutputKeys?.[0]?.enum?.join(', ') ?? '');
  const [passThreshold, setPassThreshold] = useState<number | ''>(initialOutputKeys?.[0]?.pass_threshold ?? '');
  const [outputMin, setOutputMin] = useState<number | ''>(initialOutputKeys?.[0]?.min ?? '');
  const [outputMax, setOutputMax] = useState<number | ''>(initialOutputKeys?.[0]?.max ?? '');
  const [passMatch, setPassMatch] = useState(initialOutputKeys?.[0]?.pass_match?.join(', ') ?? '');
  const [passValue, setPassValue] = useState<'true' | 'false' | ''>(() => {
    const pv = initialOutputKeys?.[0]?.pass_value;
    return pv != null ? (pv ? 'true' : 'false') : '';
  });
  const outputKeyFieldRef = useRef<HTMLDivElement>(null);
  const regexPatternFieldRef = useRef<HTMLDivElement>(null);
  const maxTokensFieldRef = useRef<HTMLDivElement>(null);
  const temperatureFieldRef = useRef<HTMLDivElement>(null);
  const schemaFieldRef = useRef<HTMLDivElement>(null);
  const heuristicFieldRef = useRef<HTMLDivElement>(null);
  const heuristicMaxLengthFieldRef = useRef<HTMLDivElement>(null);
  const passThresholdFieldRef = useRef<HTMLDivElement>(null);
  const outputMaxFieldRef = useRef<HTMLDivElement>(null);

  const [changelog, setChangelog] = useState('');

  const buildConfig = (): Record<string, unknown> => {
    switch (kind) {
      case 'llm_judge':
        return {
          provider: normalizedOptionalString(provider),
          model: normalizedOptionalString(model),
          system_prompt: normalizedOptionalString(systemPrompt),
          user_prompt: normalizedOptionalString(userPrompt),
          max_tokens: maxTokens,
          temperature,
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
          min_length: heuristicMinLength === '' ? undefined : heuristicMinLength,
          max_length: heuristicMaxLength === '' ? undefined : heuristicMaxLength,
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
    heuristicMinLength,
    heuristicMaxLength,
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
      minLength: heuristicMinLength,
      maxLength: heuristicMaxLength,
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
    if (sharedValidation.hasErrors) {
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

    onSubmit({
      version: version.trim(),
      config: buildConfig(),
      output_keys: outputKeys,
      changelog: changelog.trim() || undefined,
    });
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Version details</div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.sectionText}>
            <Text variant="body" color="secondary">
              Review the next version number and describe what changed in this release.
            </Text>
          </div>
          <div className={styles.twoColumnGrid}>
            <Field label="Version" description="Auto-generated next version.">
              <Input className={styles.compactControl} value={version} readOnly disabled />
            </Field>
            <Field label="Changelog" description="Optional summary saved with this version.">
              <Input
                className={styles.fullWidthControl}
                value={changelog}
                onChange={(e) => setChangelog(e.currentTarget.value)}
                placeholder="What changed in this version"
              />
            </Field>
          </div>
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
                  value={heuristicMinLength}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setHeuristicMinLength(v === '' ? '' : parseInt(v, 10) || 0);
                  }}
                  placeholder="e.g. 0"
                />
              </Field>
              <Field label="Max length" description="Optional. Maximum response length.">
                <div ref={heuristicMaxLengthFieldRef}>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={heuristicMaxLength}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setHeuristicMaxLength(v === '' ? '' : parseInt(v, 10) || 0);
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
              Define the score this template emits and how downstream views should interpret it.
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
              Define which output values should count as passing for this template.
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
          <Button onClick={handleSubmit}>Publish</Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </Stack>
      </div>
    </div>
  );
}
