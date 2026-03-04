import React, { useEffect, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, Input, Select, Stack, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  EVALUATOR_KIND_LABELS,
  buildOutputKeyFromForm,
  type CreateTemplateRequest,
  type EvalFormState,
  type EvalOutputKey,
  type EvaluatorKind,
  type ScoreType,
} from '../../evaluation/types';

export type TemplateFormProps = {
  onSubmit: (req: CreateTemplateRequest) => void;
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
    minWidth: 180,
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
  }),
});

function todayVersion(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function TemplateForm({ onSubmit, onCancel, onConfigChange }: TemplateFormProps) {
  const styles = useStyles2(getStyles);

  const [templateId, setTemplateId] = useState('');
  const [kind, setKind] = useState<EvaluatorKind>('llm_judge');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState(todayVersion());
  const [changelog, setChangelog] = useState('');
  const [touched, setTouched] = useState(false);

  // llm_judge config
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0);

  // json_schema config
  const [schemaJson, setSchemaJson] = useState('{}');

  // regex config
  const [pattern, setPattern] = useState('');

  // heuristic config
  const [notEmpty, setNotEmpty] = useState(false);
  const [minLength, setMinLength] = useState<number | ''>('');
  const [maxLength, setMaxLength] = useState<number | ''>('');

  // output key
  const [outputKey, setOutputKey] = useState('');
  const [outputType, setOutputType] = useState<ScoreType>('number');
  const [outputDescription, setOutputDescription] = useState('');
  const [outputEnum, setOutputEnum] = useState('');

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

  const isIdEmpty = templateId.trim() === '';
  const isVersionEmpty = version.trim() === '';
  const isOutputKeyEmpty = outputKey.trim() === '';
  let schemaParseError = '';
  if (kind === 'json_schema') {
    try {
      JSON.parse(schemaJson || '{}');
    } catch {
      schemaParseError = 'Invalid JSON';
    }
  }
  const showIdError = touched && isIdEmpty;
  const showVersionError = touched && isVersionEmpty;
  const showOutputKeyError = touched && isOutputKeyEmpty;
  const showSchemaError = touched && schemaParseError !== '';

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty || isVersionEmpty || isOutputKeyEmpty || schemaParseError) {
      return;
    }

    const outputKeys: EvalOutputKey[] = [buildOutputKeyFromForm(outputKey, outputType, outputDescription, outputEnum)];

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
    <>
      <Field
        label="Template ID"
        description="Unique identifier for this template."
        required
        invalid={showIdError}
        error={showIdError ? 'Template ID is required' : undefined}
      >
        <Input
          value={templateId}
          onChange={(e) => setTemplateId(e.currentTarget.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. my-org.helpfulness"
          width={40}
        />
      </Field>
      <Field label="Kind" description="Evaluator type for this template.">
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
      <Field label="Description" description="Optional description of what this template evaluates.">
        <Input
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="Evaluates helpfulness of assistant responses"
          width={60}
        />
      </Field>
      <Field
        label="Version"
        description="Initial version in YYYY-MM-DD or YYYY-MM-DD.N format."
        required
        invalid={showVersionError}
        error={showVersionError ? 'Version is required' : undefined}
      >
        <Input
          value={version}
          onChange={(e) => setVersion(e.currentTarget.value)}
          placeholder="2026-03-03"
          width={20}
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
        <Field
          label="Schema"
          description="JSON schema for validation."
          invalid={showSchemaError}
          error={showSchemaError ? schemaParseError : undefined}
        >
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

      <Field label="Changelog" description="Optional note about this initial version.">
        <Input
          value={changelog}
          onChange={(e) => setChangelog(e.currentTarget.value)}
          placeholder="Initial version"
          width={60}
        />
      </Field>

      <Stack direction="row" gap={1}>
        <Button onClick={handleSubmit}>Create</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </>
  );
}
