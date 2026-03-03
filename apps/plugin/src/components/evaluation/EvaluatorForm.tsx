import React, { useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, FieldSet, Input, Select, Stack, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  EVALUATOR_KIND_LABELS,
  type CreateEvaluatorRequest,
  type EvalOutputKey,
  type EvaluatorKind,
  type ScoreType,
} from '../../evaluation/types';

export type EvaluatorFormProps = {
  onSubmit: (req: CreateEvaluatorRequest) => void;
  onCancel: () => void;
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
    minHeight: 120,
    padding: theme.spacing(1, 2),
    fontFamily: theme.typography.fontFamilyMonospace,
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

export default function EvaluatorForm({ onSubmit, onCancel }: EvaluatorFormProps) {
  const styles = useStyles2(getStyles);

  const [evaluatorId, setEvaluatorId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [kind, setKind] = useState<EvaluatorKind>('llm_judge');
  const [touched, setTouched] = useState(false);

  // llm_judge: system_prompt, user_prompt, max_tokens, temperature
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0);

  // json_schema: schema
  const [schemaJson, setSchemaJson] = useState('{}');

  // regex: pattern
  const [pattern, setPattern] = useState('');

  // heuristic: not_empty, min_length, max_length
  const [notEmpty, setNotEmpty] = useState(false);
  const [minLength, setMinLength] = useState<number | ''>('');
  const [maxLength, setMaxLength] = useState<number | ''>('');

  // output key
  const [outputKey, setOutputKey] = useState('');
  const [outputType, setOutputType] = useState<ScoreType>('number');

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

  const isIdEmpty = evaluatorId.trim() === '';
  const isOutputKeyEmpty = outputKey.trim() === '';
  const showIdError = touched && isIdEmpty;
  const showOutputKeyError = touched && isOutputKeyEmpty;

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty || isOutputKeyEmpty) {
      return;
    }

    const outputKeys: EvalOutputKey[] = [{ key: outputKey.trim(), type: outputType }];

    const req: CreateEvaluatorRequest = {
      evaluator_id: evaluatorId.trim(),
      version: version.trim() || '1.0.0',
      kind,
      config: buildConfig(),
      output_keys: outputKeys,
    };
    onSubmit(req);
  };

  return (
    <FieldSet label="Create evaluator">
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
        />
      </Field>
      <Field label="Version" description="Semantic version.">
        <Input value={version} onChange={(e) => setVersion(e.currentTarget.value)} placeholder="1.0.0" width={20} />
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
              placeholder="You are an evaluation judge..."
              rows={4}
            />
          </Field>
          <Field label="User prompt" description="Required. Template with {{ generation }} placeholder.">
            <textarea
              className={styles.textarea}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.currentTarget.value)}
              placeholder="Score the following on 1-10: {{ generation }}"
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

      <Stack direction="row" gap={1}>
        <Button onClick={handleSubmit}>Create</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </FieldSet>
  );
}
