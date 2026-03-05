import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, Input, Select, Stack, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  EVALUATOR_KIND_LABELS,
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  buildOutputKeyFromForm,
  type CreateEvaluatorRequest,
  type EvalFormState,
  type EvalOutputKey,
  type Evaluator,
  type EvaluatorKind,
  type ScoreType,
} from '../../evaluation/types';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import { isValidResourceID, INVALID_ID_MESSAGE } from '../../evaluation/utils';
import { nextVersion } from '../../evaluation/versionUtils';

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
  textarea: css({
    width: '100%',
    minHeight: 180,
    padding: theme.spacing(1, 2),
    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
    fontSize: theme.typography.size.sm,
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
  outputKeyRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
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
    systemPrompt: (cfg.system_prompt as string) || LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
    userPrompt: (cfg.user_prompt as string) || LLM_JUDGE_DEFAULT_USER_PROMPT,
    maxTokens: (cfg.max_tokens as number) ?? 256,
    temperature: (cfg.temperature as number) ?? 0,
    schemaJson: typeof cfg.schema === 'object' ? JSON.stringify(cfg.schema, null, 2) : '{}',
    pattern: (cfg.pattern as string) ?? '',
    notEmpty: (cfg.not_empty as boolean) ?? false,
    minLength: cfg.min_length != null ? (cfg.min_length as number) : '',
    maxLength: cfg.max_length != null ? (cfg.max_length as number) : '',
    outputKey: firstOk?.key ?? '',
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
    return (cfg?.provider as string) ?? '';
  });
  const [model, setModel] = useState(() => {
    const cfg = seedEvaluator?.config;
    return (cfg?.model as string) ?? '';
  });
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [systemPrompt, setSystemPrompt] = useState(initialState?.systemPrompt ?? '');
  const [userPrompt, setUserPrompt] = useState(initialState?.userPrompt ?? '');
  const [maxTokens, setMaxTokens] = useState(initialState?.maxTokens ?? 256);
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

  // heuristic: not_empty, min_length, max_length
  const [notEmpty, setNotEmpty] = useState(initialState?.notEmpty ?? false);
  const [minLength, setMinLength] = useState<number | ''>(initialState?.minLength ?? '');
  const [maxLength, setMaxLength] = useState<number | ''>(initialState?.maxLength ?? '');

  // output key
  const [outputKey, setOutputKey] = useState(initialState?.outputKey ?? '');
  const [outputType, setOutputType] = useState<ScoreType>(initialState?.outputType ?? 'number');
  const [outputDescription, setOutputDescription] = useState(initialState?.outputDescription ?? '');
  const [outputEnum, setOutputEnum] = useState(initialState?.outputEnum ?? '');
  const [passThreshold, setPassThreshold] = useState<number | ''>(initialState?.passThreshold ?? '');
  const [outputMin, setOutputMin] = useState<number | ''>(initialState?.outputMin ?? '');
  const [outputMax, setOutputMax] = useState<number | ''>(initialState?.outputMax ?? '');
  const [passMatch, setPassMatch] = useState(initialState?.passMatch ?? '');
  const [passValue, setPassValue] = useState<'true' | 'false' | ''>(initialState?.passValue ?? '');

  const versionManuallyEdited = useRef(false);
  const prevExistingVersionsKey = useRef<string>('');

  useEffect(() => {
    if (!isEdit || existingVersions == null || versionManuallyEdited.current) {
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
          provider: provider || undefined,
          model: model || undefined,
          system_prompt: systemPrompt || undefined,
          user_prompt: userPrompt || undefined,
          max_tokens: maxTokens,
          temperature: temperature,
        };
      case 'json_schema':
        try {
          return { schema: JSON.parse(schemaJson || '{}') };
        } catch {
          return { schema: {} };
        }
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

  const isIdEmpty = evaluatorId.trim() === '';
  const isIdInvalid = !isIdEmpty && !isValidResourceID(evaluatorId.trim());
  const idError = isIdEmpty ? 'Evaluator ID is required' : isIdInvalid ? INVALID_ID_MESSAGE : undefined;
  const showIdError = touched && (isIdEmpty || isIdInvalid);

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty || isIdInvalid) {
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
    <>
      <Field
        label="Evaluator ID"
        description="Unique identifier for this evaluator."
        required
        invalid={showIdError}
        error={idError}
      >
        <Input
          value={evaluatorId}
          onChange={(e) => setEvaluatorId(e.currentTarget.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. custom.helpfulness"
          width={40}
          disabled={isEdit}
        />
      </Field>
      <Field label="Version" description="Initial version in YYYY-MM-DD or YYYY-MM-DD.N format.">
        <Input
          value={version}
          onChange={(e) => {
            setVersion(e.currentTarget.value);
            versionManuallyEdited.current = true;
          }}
          placeholder="YYYY-MM-DD"
          width={20}
        />
      </Field>
      <Field label="Kind" description="Evaluator type.">
        <Select<EvaluatorKind>
          options={KIND_OPTIONS}
          value={kind}
          onChange={(v) => {
            if (v?.value) {
              setKind(v.value);
            }
          }}
          width={24}
        />
      </Field>
      <Field label="Description" description="Optional description shown in score tooltips.">
        <Input
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="e.g. Checks whether the response is helpful"
          width={60}
        />
      </Field>

      {kind === 'llm_judge' && (
        <>
          <Stack direction="row" gap={2}>
            <Field label="Provider" description="LLM provider for the judge.">
              <Select<string>
                options={providerOptions}
                value={provider || undefined}
                onChange={(v) => {
                  setProvider(v?.value ?? '');
                  setModel('');
                  setModelOptions([]);
                }}
                isClearable
                placeholder="Default"
                width={20}
              />
            </Field>
            <Field label="Model" description="Model to use for judging.">
              <Select<string>
                options={modelOptions}
                value={model || undefined}
                onChange={(v) => setModel(v?.value ?? '')}
                isClearable
                allowCustomValue
                placeholder="Default"
                width={24}
              />
            </Field>
          </Stack>
          <Field label="System prompt" description="Optional. Instructions for the judge model.">
            <textarea
              className={styles.textarea}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.currentTarget.value)}
              placeholder="You are an expert evaluator assessing the helpfulness of AI assistant responses. Consider accuracy, relevance, completeness, and clarity."
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
              placeholder={'User input:\n{{input}}\n\nAssistant output:\n{{output}}'}
              rows={4}
            />
          </Field>
          <Stack direction="row" gap={2}>
            <Field label="Max tokens">
              <Input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.currentTarget.value, 10) || 0)}
                width={12}
              />
            </Field>
            <Field label="Temperature">
              <Input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.currentTarget.value) || 0)}
                width={12}
              />
            </Field>
          </Stack>
        </>
      )}

      {kind === 'json_schema' && (
        <Field label="Schema" description="JSON schema for validation.">
          <textarea
            className={styles.textarea}
            value={schemaJson}
            onChange={(e) => setSchemaJson(e.currentTarget.value)}
            placeholder='{"type": "object", "properties": {...}}'
            rows={6}
          />
        </Field>
      )}

      {kind === 'regex' && (
        <Field label="Pattern" description="Regex pattern to match.">
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.currentTarget.value)}
            placeholder="e.g. ^[A-Z].*"
            width={40}
          />
        </Field>
      )}

      {kind === 'heuristic' && (
        <>
          <Field label="Not empty" description="Require non-empty output.">
            <Switch value={notEmpty} onChange={(e) => setNotEmpty(e.currentTarget.checked)} />
          </Field>
          <Stack direction="row" gap={2}>
            <Field label="Min length">
              <Input
                type="number"
                value={minLength}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setMinLength(v === '' ? '' : parseInt(v, 10) || 0);
                }}
                placeholder="—"
                width={12}
              />
            </Field>
            <Field label="Max length">
              <Input
                type="number"
                value={maxLength}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setMaxLength(v === '' ? '' : parseInt(v, 10) || 0);
                }}
                placeholder="—"
                width={12}
              />
            </Field>
          </Stack>
        </>
      )}

      <Field label="Output key" description="Key and type for the evaluation result.">
        <div className={styles.outputKeyRow}>
          <Input
            value={outputKey}
            onChange={(e) => setOutputKey(e.currentTarget.value)}
            placeholder="score"
            width={20}
          />
          <Select<ScoreType>
            options={SCORE_TYPE_OPTIONS}
            value={outputType}
            onChange={(v) => {
              if (v?.value) {
                setOutputType(v.value);
              }
            }}
            width={16}
          />
        </div>
      </Field>
      <Field
        label="Output description"
        description={
          kind === 'llm_judge'
            ? 'Included in the LLM Judge prompt to guide scoring.'
            : 'Optional metadata for the output key.'
        }
      >
        <Input
          value={outputDescription}
          onChange={(e) => setOutputDescription(e.currentTarget.value)}
          placeholder="e.g. How helpful the response is on a 1-10 scale"
          width={60}
        />
      </Field>
      {kind === 'llm_judge' && outputType === 'string' && (
        <Field
          label="Allowed values"
          description="Comma-separated list of allowed string values. Enforced via structured output."
        >
          <Input
            value={outputEnum}
            onChange={(e) => setOutputEnum(e.currentTarget.value)}
            placeholder="e.g. none, mild, moderate, severe"
            width={60}
          />
        </Field>
      )}
      {outputType === 'number' && (
        <Stack direction="row" gap={1}>
          <Field label="Pass threshold" description="Score >= this value passes.">
            <Input
              type="number"
              value={passThreshold}
              onChange={(e) => setPassThreshold(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
              placeholder="—"
              width={12}
            />
          </Field>
          <Field label="Min" description="Scores below this are dropped.">
            <Input
              type="number"
              value={outputMin}
              onChange={(e) => setOutputMin(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
              placeholder="—"
              width={12}
            />
          </Field>
          <Field label="Max" description="Scores above this are dropped.">
            <Input
              type="number"
              value={outputMax}
              onChange={(e) => setOutputMax(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
              placeholder="—"
              width={12}
            />
          </Field>
        </Stack>
      )}
      {outputType === 'string' && (
        <Field label="Pass values" description="Comma-separated values that count as passing.">
          <Input
            value={passMatch}
            onChange={(e) => setPassMatch(e.currentTarget.value)}
            placeholder="e.g. none, mild"
            width={60}
          />
        </Field>
      )}
      {outputType === 'bool' && (
        <Field label="Pass when" description="Which boolean value counts as passing.">
          <Select<string>
            options={[
              { label: 'true (default)', value: '' },
              { label: 'true', value: 'true' },
              { label: 'false', value: 'false' },
            ]}
            value={passValue}
            onChange={(v) => setPassValue((v?.value ?? '') as 'true' | 'false' | '')}
            width={20}
          />
        </Field>
      )}

      <Stack direction="row" gap={1}>
        <Button onClick={handleSubmit}>{isEdit ? 'Update' : 'Create'}</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </>
  );
}
