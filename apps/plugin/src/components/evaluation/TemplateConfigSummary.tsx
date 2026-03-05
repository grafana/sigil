import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Field, Input, Stack, useStyles2 } from '@grafana/ui';
import {
  LLM_JUDGE_DEFAULT_SYSTEM_PROMPT,
  LLM_JUDGE_DEFAULT_USER_PROMPT,
  type EvalOutputKey,
  type EvaluatorKind,
} from '../../evaluation/types';
import { formatHeuristicStringList, normalizeHeuristicStringList } from '../../evaluation/heuristicConfig';

export type TemplateConfigSummaryProps = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  outputKeys: EvalOutputKey[];
};

const getStyles = (theme: GrafanaTheme2) => ({
  readonlyTextarea: css({
    width: '100%',
    minHeight: 80,
    padding: theme.spacing(1, 2),
    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
    fontSize: theme.typography.size.sm,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    color: theme.colors.text.secondary,
    resize: 'none' as const,
  }),
  outputKeyRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
});

export default function TemplateConfigSummary({ kind, config, outputKeys }: TemplateConfigSummaryProps) {
  const styles = useStyles2(getStyles);
  const ok = outputKeys[0];
  const containsValues = normalizeHeuristicStringList(config.contains);
  const notContainsValues = normalizeHeuristicStringList(config.not_contains);

  return (
    <>
      {kind === 'llm_judge' && (
        <>
          <Stack direction="row" gap={2}>
            <Field label="Provider">
              <Input value={String(config.provider ?? 'Default')} readOnly disabled width={20} />
            </Field>
            <Field label="Model">
              <Input value={String(config.model ?? 'Default')} readOnly disabled width={24} />
            </Field>
          </Stack>
          <Field label="System prompt">
            <textarea
              className={styles.readonlyTextarea}
              value={String(config.system_prompt || LLM_JUDGE_DEFAULT_SYSTEM_PROMPT)}
              readOnly
              rows={3}
            />
          </Field>
          <Field label="User prompt">
            <textarea
              className={styles.readonlyTextarea}
              value={String(config.user_prompt || LLM_JUDGE_DEFAULT_USER_PROMPT)}
              readOnly
              rows={3}
            />
          </Field>
          <Stack direction="row" gap={2}>
            <Field label="Max tokens">
              <Input value={String(config.max_tokens ?? 256)} readOnly disabled width={12} />
            </Field>
            <Field label="Temperature">
              <Input value={String(config.temperature ?? 0)} readOnly disabled width={12} />
            </Field>
          </Stack>
        </>
      )}

      {kind === 'json_schema' && (
        <Field label="Schema">
          <textarea
            className={styles.readonlyTextarea}
            value={config.schema ? JSON.stringify(config.schema, null, 2) : '{}'}
            readOnly
            rows={6}
          />
        </Field>
      )}

      {kind === 'regex' && (
        <Field label="Pattern">
          <Input value={String(config.pattern ?? '')} readOnly disabled width={40} />
        </Field>
      )}

      {kind === 'heuristic' && (
        <>
          <Field label="Not empty">
            <Input value={config.not_empty ? 'Yes' : 'No'} readOnly disabled width={12} />
          </Field>
          <Stack direction="row" gap={2}>
            <Field label="Min length">
              <Input value={config.min_length != null ? String(config.min_length) : '—'} readOnly disabled width={12} />
            </Field>
            <Field label="Max length">
              <Input value={config.max_length != null ? String(config.max_length) : '—'} readOnly disabled width={12} />
            </Field>
          </Stack>
          {containsValues.length > 0 && (
            <Field label="Contains">
              <textarea
                className={styles.readonlyTextarea}
                value={formatHeuristicStringList(config.contains)}
                readOnly
                rows={3}
              />
            </Field>
          )}
          {notContainsValues.length > 0 && (
            <Field label="Not contains">
              <textarea
                className={styles.readonlyTextarea}
                value={formatHeuristicStringList(config.not_contains)}
                readOnly
                rows={3}
              />
            </Field>
          )}
        </>
      )}

      {ok && (
        <>
          <Field label="Output key">
            <div className={styles.outputKeyRow}>
              <Input value={ok.key} readOnly disabled width={20} />
              <Input value={ok.type} readOnly disabled width={16} />
            </div>
          </Field>
          {ok.description && (
            <Field label="Output description">
              <Input value={ok.description} readOnly disabled width={60} />
            </Field>
          )}
          {ok.type === 'number' && (ok.pass_threshold != null || ok.min != null || ok.max != null) && (
            <Stack direction="row" gap={1}>
              {ok.pass_threshold != null && (
                <Field label="Pass threshold">
                  <Input value={String(ok.pass_threshold)} readOnly disabled width={12} />
                </Field>
              )}
              {ok.min != null && (
                <Field label="Min">
                  <Input value={String(ok.min)} readOnly disabled width={12} />
                </Field>
              )}
              {ok.max != null && (
                <Field label="Max">
                  <Input value={String(ok.max)} readOnly disabled width={12} />
                </Field>
              )}
            </Stack>
          )}
          {ok.type === 'string' && (ok.enum?.length ?? 0) > 0 && (
            <Field label="Allowed values">
              <Input value={ok.enum!.join(', ')} readOnly disabled width={60} />
            </Field>
          )}
          {ok.type === 'string' && (ok.pass_match?.length ?? 0) > 0 && (
            <Field label="Pass values">
              <Input value={ok.pass_match!.join(', ')} readOnly disabled width={60} />
            </Field>
          )}
          {ok.type === 'bool' && ok.pass_value != null && (
            <Field label="Pass when">
              <Input value={String(ok.pass_value)} readOnly disabled width={12} />
            </Field>
          )}
        </>
      )}
    </>
  );
}
