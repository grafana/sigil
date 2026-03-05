import React, { useEffect, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, Input, Select, Stack, Switch, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  EVALUATOR_KIND_LABELS,
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  buildOutputKeyFromForm,
  type CreateTemplateRequest,
  type EvalFormState,
  type EvalOutputKey,
  type EvaluatorKind,
  type ScoreType,
} from '../../evaluation/types';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import { isValidResourceID, INVALID_ID_MESSAGE } from '../../evaluation/utils';
import { getSectionTitleStyles } from './sectionStyles';

export type TemplateFormProps = {
  onSubmit: (req: CreateTemplateRequest) => void;
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
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
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
  threeColumnGrid: css({
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

function todayVersion(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function TemplateForm({ onSubmit, onCancel, onConfigChange, dataSource }: TemplateFormProps) {
  const styles = useStyles2(getStyles);
  const ds = dataSource ?? defaultEvaluationDataSource;

  const [templateId, setTemplateId] = useState('');
  const [kind, setKind] = useState<EvaluatorKind>('llm_judge');
  const [description, setDescription] = useState('');
  const [version] = useState(todayVersion());
  const [changelog, setChangelog] = useState('');
  const [touched, setTouched] = useState(false);

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0);

  useEffect(() => {
    void ds
      .listJudgeProviders()
      .then((res) => {
        setProviderOptions(res.providers.map((p) => ({ label: p.name, value: p.id })));
      })
      .catch(() => {});
  }, [ds]);

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

  const [schemaJson, setSchemaJson] = useState('{}');
  const [pattern, setPattern] = useState('');
  const [notEmpty, setNotEmpty] = useState(false);
  const [minLength, setMinLength] = useState<number | ''>('');
  const [maxLength, setMaxLength] = useState<number | ''>('');

  const [outputKey, setOutputKey] = useState('score');
  const [outputType, setOutputType] = useState<ScoreType>('number');
  const [outputDescription, setOutputDescription] = useState('');
  const [outputEnum, setOutputEnum] = useState('');
  const [passThreshold, setPassThreshold] = useState<number | ''>('');
  const [outputMin, setOutputMin] = useState<number | ''>('');
  const [outputMax, setOutputMax] = useState<number | ''>('');
  const [passMatch, setPassMatch] = useState('');
  const [passValue, setPassValue] = useState<'true' | 'false' | ''>('');

  const buildConfig = (): Record<string, unknown> => {
    switch (kind) {
      case 'llm_judge':
        return {
          provider: provider || undefined,
          model: model || undefined,
          system_prompt: systemPrompt || undefined,
          user_prompt: userPrompt || undefined,
          max_tokens: maxTokens,
          temperature,
        };
      case 'json_schema':
        return { schema: JSON.parse(schemaJson || '{}') };
      case 'regex':
        return { pattern: pattern || '' };
      case 'heuristic':
        return {
          not_empty: notEmpty,
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

  const isIdEmpty = templateId.trim() === '';
  const isIdInvalid = !isIdEmpty && !isValidResourceID(templateId.trim());
  const templateIdError = isIdEmpty ? 'Template ID is required' : isIdInvalid ? INVALID_ID_MESSAGE : undefined;
  const isOutputKeyEmpty = outputKey.trim() === '';
  const outputKeyError = isOutputKeyEmpty ? 'Output key is required' : undefined;
  const isRegexPatternEmpty = kind === 'regex' && pattern.trim() === '';
  const regexPatternError = isRegexPatternEmpty ? 'Pattern is required' : undefined;
  const isMaxTokensInvalid = kind === 'llm_judge' && (!Number.isInteger(maxTokens) || maxTokens < 1);
  const maxTokensError = isMaxTokensInvalid ? 'Must be an integer greater than 0' : undefined;
  const isTemperatureInvalid = kind === 'llm_judge' && (!Number.isFinite(temperature) || temperature < 0);
  const temperatureError = isTemperatureInvalid ? 'Must be 0 or greater' : undefined;
  let schemaParseError = '';
  if (kind === 'json_schema') {
    try {
      JSON.parse(schemaJson || '{}');
    } catch {
      schemaParseError = 'Invalid JSON';
    }
  }
  const isHeuristicRangeInvalid =
    kind === 'heuristic' && minLength !== '' && maxLength !== '' && Number(minLength) > Number(maxLength);
  const heuristicMaxLengthError = isHeuristicRangeInvalid ? 'Must be greater than or equal to Min length' : undefined;
  const isOutputRangeInvalid = outputType === 'number' && outputMin !== '' && outputMax !== '' && outputMin > outputMax;
  const outputMaxError = isOutputRangeInvalid ? 'Must be greater than or equal to Min' : undefined;

  const showIdError = touched && (isIdEmpty || isIdInvalid);
  const showOutputKeyError = touched && isOutputKeyEmpty;
  const showRegexPatternError = touched && isRegexPatternEmpty;
  const showMaxTokensError = touched && isMaxTokensInvalid;
  const showTemperatureError = touched && isTemperatureInvalid;
  const showSchemaError = touched && schemaParseError !== '';
  const showHeuristicMaxLengthError = touched && isHeuristicRangeInvalid;
  const showOutputMaxError = touched && isOutputRangeInvalid;

  const handleSubmit = () => {
    setTouched(true);
    if (
      isIdEmpty ||
      isIdInvalid ||
      isOutputKeyEmpty ||
      isRegexPatternEmpty ||
      isMaxTokensInvalid ||
      isTemperatureInvalid ||
      schemaParseError !== '' ||
      isHeuristicRangeInvalid ||
      isOutputRangeInvalid
    ) {
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

    const req: CreateTemplateRequest = {
      template_id: templateId.trim(),
      kind,
      description: description.trim() || undefined,
      version: version.trim(),
      config: buildConfig(),
      output_keys: outputKeys,
      changelog: changelog.trim() || undefined,
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
              Set the template identity, describe what it evaluates, and capture any note for the first version.
            </Text>
          </div>
          <div className={styles.twoColumnGrid}>
            <Field label="Template ID" description="Unique identifier for this template." required>
              <>
                <Input
                  className={styles.compactControl}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.currentTarget.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="e.g. my_org.helpfulness"
                />
                {showIdError && templateIdError && (
                  <div className={styles.validationMessage}>
                    <Text variant="bodySmall" color="error">
                      {templateIdError}
                    </Text>
                  </div>
                )}
              </>
            </Field>
            <Field label="Kind" description="Select how this template scores a generation.">
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
          <Field label="Description" description="Optional summary shown alongside this template.">
            <textarea
              className={`${styles.textarea} ${styles.descriptionTextarea}`}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="e.g. Evaluates whether the assistant response is helpful and grounded."
              rows={3}
            />
          </Field>
          <Field label="Changelog" description="Optional note saved with this first version.">
            <Input
              className={styles.fullWidthControl}
              value={changelog}
              onChange={(e) => setChangelog(e.currentTarget.value)}
              placeholder="Initial version"
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
              <Field label="Provider">
                <Select<string>
                  className={styles.compactControl}
                  options={providerOptions}
                  value={provider || undefined}
                  onChange={(v) => {
                    setProvider(v?.value ?? '');
                    setModel('');
                    setModelOptions([]);
                  }}
                  isClearable
                  placeholder="Default"
                />
              </Field>
              <Field label="Model">
                <Select<string>
                  className={styles.compactControl}
                  options={modelOptions}
                  value={model || undefined}
                  onChange={(v) => setModel(v?.value ?? '')}
                  isClearable
                  allowCustomValue
                  placeholder="Default"
                />
              </Field>
            </div>
            <Field label="System prompt" description="Instructions for the judge model.">
              <textarea
                className={styles.textarea}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.currentTarget.value)}
                placeholder={LLM_JUDGE_DEFAULT_SYSTEM_PROMPT}
                rows={4}
              />
            </Field>
            <Field
              label="User prompt"
              description="Supports {{input}}, {{output}}, {{generation_id}}, {{conversation_id}}."
            >
              <textarea
                className={styles.textarea}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.currentTarget.value)}
                placeholder={LLM_JUDGE_DEFAULT_USER_PROMPT}
                rows={4}
              />
            </Field>
            <div className={styles.twoColumnGrid}>
              <Field label="Max tokens">
                <>
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
                </>
              </Field>
              <Field label="Temperature">
                <>
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
                </>
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
            <Field label="Schema" description="JSON schema for validation.">
              <>
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
              </>
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
              <>
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
              </>
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
            <Field className={styles.switchField} label="Not empty" description="Require non-empty output.">
              <Switch value={notEmpty} onChange={(e) => setNotEmpty(e.currentTarget.checked)} />
            </Field>
            <div className={styles.twoColumnGrid}>
              <Field label="Min length">
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
              <Field label="Max length">
                <>
                  <Input
                    className={styles.numericControl}
                    type="number"
                    value={maxLength}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setMaxLength(v === '' ? '' : parseInt(v, 10) || 0);
                    }}
                    placeholder="e.g. 0"
                  />
                  {showHeuristicMaxLengthError && heuristicMaxLengthError && (
                    <div className={styles.validationMessage}>
                      <Text variant="bodySmall" color="error">
                        {heuristicMaxLengthError}
                      </Text>
                    </div>
                  )}
                </>
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
              <>
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
              </>
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
                ? 'Included in the LLM Judge prompt to guide scoring.'
                : 'Optional metadata for the output key.'
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
              description="Comma-separated list of allowed string values. Enforced via structured output."
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
            <div className={styles.threeColumnGrid}>
              <Field label="Pass threshold">
                <Input
                  className={styles.numericControl}
                  type="number"
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
                  placeholder="e.g. 5"
                />
              </Field>
              <Field label="Min">
                <Input
                  className={styles.numericControl}
                  type="number"
                  value={outputMin}
                  onChange={(e) => setOutputMin(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
                  placeholder="e.g. 1"
                />
              </Field>
              <Field label="Max">
                <>
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
                </>
              </Field>
            </div>
          )}
          {outputType === 'string' && (
            <Field label="Pass values" description="Comma-separated values that count as passing.">
              <Input
                className={styles.fullWidthControl}
                value={passMatch}
                onChange={(e) => setPassMatch(e.currentTarget.value)}
                placeholder="e.g. none, mild"
              />
            </Field>
          )}
          {outputType === 'bool' && (
            <Field label="Pass when" description="Which boolean value counts as passing.">
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
          <Button onClick={handleSubmit}>Create</Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </Stack>
      </div>
    </div>
  );
}
