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
      outputKeys: [buildOutputKeyFromForm(outputKey, outputType, outputDescription, outputEnum)],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, configJson, outputKey, outputType, outputDescription, outputEnum]);

  const isVersionEmpty = version.trim() === '';
  const isOutputKeyEmpty = outputKey.trim() === '';
  let configParseError = '';
  try {
    JSON.parse(configJson);
  } catch {
    configParseError = 'Invalid JSON';
  }
  const showVersionError = touched && isVersionEmpty;
  const showOutputKeyError = touched && isOutputKeyEmpty;
  const showConfigError = touched && configParseError !== '';

  const handleSubmit = () => {
    setTouched(true);
    if (isVersionEmpty || isOutputKeyEmpty || configParseError) {
      return;
    }

    const config: Record<string, unknown> = JSON.parse(configJson);

    const outputKeys: EvalOutputKey[] = [buildOutputKeyFromForm(outputKey, outputType, outputDescription, outputEnum)];

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
