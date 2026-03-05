import React, { useEffect, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, FieldSet, Input, Select, Stack, Switch, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  buildOutputKeyFromForm,
  type EvalFormState,
  type EvalOutputKey,
  type EvaluatorKind,
  type PublishVersionRequest,
  type ScoreType,
} from '../../evaluation/types';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import { nextVersion } from '../../evaluation/versionUtils';

export type PublishVersionFormProps = {
  kind: EvaluatorKind;
  initialConfig?: Record<string, unknown>;
  initialOutputKeys?: EvalOutputKey[];
  rollbackVersion?: string;
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

export default function PublishVersionForm({
  kind,
  initialConfig,
  initialOutputKeys,
  rollbackVersion,
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

  // llm_judge config
  const [provider, setProvider] = useState(() => String(initialConfig?.provider ?? ''));
  const [model, setModel] = useState(() => String(initialConfig?.model ?? ''));
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);
  const [systemPrompt, setSystemPrompt] = useState(() =>
    String(initialConfig?.system_prompt || LLM_JUDGE_DEFAULT_SYSTEM_PROMPT)
  );
  const [userPrompt, setUserPrompt] = useState(() =>
    String(initialConfig?.user_prompt || LLM_JUDGE_DEFAULT_USER_PROMPT)
  );
  const [maxTokens, setMaxTokens] = useState(() => {
    const v = initialConfig?.max_tokens;
    return typeof v === 'number' ? v : 256;
  });
  const [temperature, setTemperature] = useState(() => {
    const v = initialConfig?.temperature;
    return typeof v === 'number' ? v : 0;
  });

  // json_schema config
  const [schemaJson, setSchemaJson] = useState(() => {
    const s = initialConfig?.schema;
    return s ? JSON.stringify(s, null, 2) : '{}';
  });

  // regex config
  const [pattern, setPattern] = useState(() => String(initialConfig?.pattern ?? ''));

  // heuristic config
  const [notEmpty, setNotEmpty] = useState(() => Boolean(initialConfig?.not_empty));
  const [heuristicMinLength, setHeuristicMinLength] = useState<number | ''>(() => {
    const v = initialConfig?.min_length;
    return typeof v === 'number' ? v : '';
  });
  const [heuristicMaxLength, setHeuristicMaxLength] = useState<number | ''>(() => {
    const v = initialConfig?.max_length;
    return typeof v === 'number' ? v : '';
  });

  // Load judge providers on mount
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

  // Load models when provider changes
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

  // output key
  const [outputKey, setOutputKey] = useState(initialOutputKeys?.[0]?.key ?? '');
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

  const [changelog, setChangelog] = useState(rollbackVersion ? `Rollback to version ${rollbackVersion}` : '');

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

  let schemaParseError = '';
  if (kind === 'json_schema') {
    try {
      JSON.parse(schemaJson || '{}');
    } catch {
      schemaParseError = 'Invalid JSON';
    }
  }
  const showSchemaError = touched && schemaParseError !== '';

  const handleSubmit = () => {
    setTouched(true);
    if (schemaParseError) {
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

  const label = rollbackVersion ? `Publish new version (rollback from ${rollbackVersion})` : 'Publish new version';

  return (
    <FieldSet label={label}>
      <Field label="Version" description="Auto-incremented version.">
        <Input value={version} readOnly disabled width={20} />
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
                value={heuristicMinLength}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setHeuristicMinLength(v === '' ? '' : parseInt(v, 10) || 0);
                }}
                placeholder="—"
                width={12}
              />
            </Field>
            <Field label="Max length">
              <Input
                type="number"
                value={heuristicMaxLength}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setHeuristicMaxLength(v === '' ? '' : parseInt(v, 10) || 0);
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

      <Field label="Changelog" description="Description of changes in this version.">
        <Input
          value={changelog}
          onChange={(e) => setChangelog(e.currentTarget.value)}
          placeholder="What changed in this version"
          width={60}
        />
      </Field>

      <Stack direction="row" gap={1}>
        <Button onClick={handleSubmit}>Publish</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </FieldSet>
  );
}
