import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, Input, Select, Stack, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  EVALUATOR_KIND_LABELS,
  buildOutputKeyFromForm,
  type CreateEvaluatorRequest,
  type EvalFormState,
  type EvalOutputKey,
  type Evaluator,
  type EvaluatorKind,
  type ScoreType,
} from '../../evaluation/types';
import { nextVersion } from '../../evaluation/versionUtils';

export type EvaluatorFormProps = {
  initialEvaluator?: Evaluator;
  /** When editing, pass existing versions so the form suggests a new unique version. */
  existingVersions?: string[];
  onSubmit: (req: CreateEvaluatorRequest) => void;
  onCancel: () => void;
  onConfigChange?: (state: EvalFormState) => void;
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
  e: Evaluator,
  existingVersions?: string[]
): {
  evaluatorId: string;
  version: string;
  kind: EvaluatorKind;
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
} {
  const cfg = e.config ?? {};
  const firstOk = e.output_keys?.[0];
  const versionsToAvoid = existingVersions ?? (e.version ? [e.version] : []);
  return {
    evaluatorId: e.evaluator_id ?? '',
    version: nextVersion(versionsToAvoid.length > 0 ? versionsToAvoid : undefined),
    kind: e.kind ?? 'llm_judge',
    systemPrompt: (cfg.system_prompt as string) ?? '',
    userPrompt: (cfg.user_prompt as string) ?? '',
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
  };
}

export default function EvaluatorForm({
  initialEvaluator,
  existingVersions,
  onSubmit,
  onCancel,
  onConfigChange,
}: EvaluatorFormProps) {
  const styles = useStyles2(getStyles);
  const isEdit = initialEvaluator != null;
  const initialState = useMemo(
    () => (initialEvaluator != null ? parseEvaluatorToFormState(initialEvaluator, existingVersions) : null),
    // Only needed for initial mount; initialEvaluator/existingVersions are stable for the component lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [evaluatorId, setEvaluatorId] = useState(() => initialState?.evaluatorId ?? '');
  const [version, setVersion] = useState(() => initialState?.version ?? nextVersion());
  const [kind, setKind] = useState<EvaluatorKind>(initialState?.kind ?? 'llm_judge');
  const [touched, setTouched] = useState(false);

  // llm_judge: system_prompt, user_prompt, max_tokens, temperature
  const [systemPrompt, setSystemPrompt] = useState(initialState?.systemPrompt ?? '');
  const [userPrompt, setUserPrompt] = useState(initialState?.userPrompt ?? '');
  const [maxTokens, setMaxTokens] = useState(initialState?.maxTokens ?? 256);
  const [temperature, setTemperature] = useState(initialState?.temperature ?? 0);

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
      outputKeys: [buildOutputKeyFromForm(outputKey, outputType, outputDescription, outputEnum)],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    kind,
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
  ]);

  const isIdEmpty = evaluatorId.trim() === '';
  const isOutputKeyEmpty = outputKey.trim() === '';
  const showIdError = touched && isIdEmpty;
  const showOutputKeyError = touched && isOutputKeyEmpty;

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty || isOutputKeyEmpty) {
      return;
    }

    const outputKeys: EvalOutputKey[] = [buildOutputKeyFromForm(outputKey, outputType, outputDescription, outputEnum)];

    const req: CreateEvaluatorRequest = {
      evaluator_id: evaluatorId.trim(),
      version: version.trim() || nextVersion(),
      kind,
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
        error={showIdError ? 'Evaluator ID is required' : undefined}
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

      {kind === 'llm_judge' && (
        <>
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
              placeholder={
                'Score the assistant output on a scale of 1-10.\n\nUser input:\n{{input}}\n\nAssistant output:\n{{output}}\n\nRespond with only a number from 1 to 10.'
              }
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

      <Field
        label="Output key"
        description="Key and type for the evaluation result."
        required
        invalid={showOutputKeyError}
        error={showOutputKeyError ? 'Output key is required' : undefined}
      >
        <div className={styles.outputKeyRow}>
          <Input
            value={outputKey}
            onChange={(e) => setOutputKey(e.currentTarget.value)}
            placeholder="e.g. score"
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
      {kind === 'llm_judge' && (
        <>
          <Field
            label="Output description"
            description="Optional description for the output key. Helps the judge model understand what to produce."
          >
            <Input
              value={outputDescription}
              onChange={(e) => setOutputDescription(e.currentTarget.value)}
              placeholder="e.g. How helpful the response is on a 0-1 scale"
              width={60}
            />
          </Field>
          {outputType === 'string' && (
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
        </>
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
