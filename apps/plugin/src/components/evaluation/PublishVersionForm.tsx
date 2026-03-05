import React, { useEffect, useState } from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Field, FieldSet, Input, Select, Stack, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  buildOutputKeyFromForm,
  type EvalFormState,
  type EvalOutputKey,
  type EvaluatorKind,
  type PublishVersionRequest,
  type ScoreType,
} from '../../evaluation/types';
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
};

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
}: PublishVersionFormProps) {
  const styles = useStyles2(getStyles);

  const [version, setVersion] = useState(() => nextVersion(existingVersions));
  const [configJson, setConfigJson] = useState(initialConfig ? JSON.stringify(initialConfig, null, 2) : '{}');
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
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = JSON.parse(configJson);
    } catch {
      /* ignore parse errors */
    }
    onConfigChange?.({
      kind,
      config: parsedConfig,
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
    configJson,
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

  const isVersionEmpty = version.trim() === '';

  let configParseError = '';
  try {
    JSON.parse(configJson);
  } catch {
    configParseError = 'Invalid JSON';
  }
  const showVersionError = touched && isVersionEmpty;

  const showConfigError = touched && configParseError !== '';

  const handleSubmit = () => {
    setTouched(true);
    if (isVersionEmpty || configParseError) {
      return;
    }

    const config: Record<string, unknown> = JSON.parse(configJson);

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
      config,
      output_keys: outputKeys,
      changelog: changelog.trim() || undefined,
    });
  };

  const label = rollbackVersion ? `Publish new version (rollback from ${rollbackVersion})` : 'Publish new version';

  return (
    <FieldSet label={label}>
      <Field
        label="Version"
        description="Version in YYYY-MM-DD or YYYY-MM-DD.N format."
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

      <Field
        label="Config"
        description="Evaluator configuration as JSON."
        invalid={showConfigError}
        error={showConfigError ? configParseError : undefined}
      >
        <textarea
          className={styles.textarea}
          value={configJson}
          onChange={(e) => setConfigJson(e.currentTarget.value)}
          rows={8}
        />
      </Field>

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
