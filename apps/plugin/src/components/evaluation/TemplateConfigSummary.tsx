import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Text, useStyles2 } from '@grafana/ui';
import {
  JSON_SCHEMA_SUPPORTED_KEYWORDS,
  getEffectiveLLMJudgePrompts,
  normalizedOptionalString,
  type EvalOutputKey,
  type EvaluatorKind,
} from '../../evaluation/types';
import { formatHeuristicStringList, normalizeHeuristicStringList } from '../../evaluation/heuristicConfig';
import { getSectionTitleStyles } from './sectionStyles';

export type TemplateConfigSummaryProps = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  outputKeys: EvalOutputKey[];
};

function highlightTemplateVars(text: string, templateVarClass: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (/^\{\{[^}]+\}\}$/.test(part)) {
      return (
        <span key={i} className={templateVarClass}>
          {part}
        </span>
      );
    }
    return part;
  });
}

function formatPassValue(value: boolean): string {
  return value ? 'Score is true' : 'Score is false';
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
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
    padding: theme.spacing(0.75, 1.25, 0.25),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  sectionTitle: css({
    ...getSectionTitleStyles(theme),
  }),
  sectionBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.25),
    '& > *': {
      margin: '0 !important',
    },
  }),
  sectionText: css({
    margin: 0,
  }),
  twoColumnGrid: css({
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: theme.spacing(1.25),
    alignItems: 'start',
    '@media (min-width: 900px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  }),
  valueCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
  valueLabel: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  valueBlock: css({
    display: 'flex',
    alignItems: 'center',
    minHeight: theme.spacing(5),
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    wordBreak: 'break-word' as const,
    cursor: 'default',
  }),
  valueBlockMuted: css({
    color: theme.colors.text.secondary,
  }),
  codeBlock: css({
    margin: 0,
    width: '100%',
    minHeight: 84,
    padding: theme.spacing(1, 1.25),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflowX: 'auto' as const,
    cursor: 'default',
  }),
  templateVar: css({
    color: theme.colors.warning.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  outputHeader: css({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(1),
  }),
  constraintsGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: theme.spacing(1),
  }),
});

export default function TemplateConfigSummary({ kind, config, outputKeys }: TemplateConfigSummaryProps) {
  const styles = useStyles2(getStyles);
  const ok = outputKeys[0];
  const provider = normalizedOptionalString(config.provider);
  const model = normalizedOptionalString(config.model);
  const { systemPrompt, userPrompt } = getEffectiveLLMJudgePrompts(config);
  const maxTokens =
    typeof config.max_tokens === 'number' && Number.isFinite(config.max_tokens) && config.max_tokens > 0
      ? config.max_tokens
      : 128;
  const containsValues = normalizeHeuristicStringList(config.contains);
  const notContainsValues = normalizeHeuristicStringList(config.not_contains);
  const patternList = Array.isArray(config.patterns)
    ? config.patterns.map((value) => String(value)).filter(Boolean)
    : [];
  const singlePattern = typeof config.pattern === 'string' ? config.pattern : '';
  const regexPreview = patternList.length > 0 ? patternList.join('\n') : singlePattern;

  return (
    <div className={styles.container}>
      {kind === 'llm_judge' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Judge configuration</div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionText}>
              <Text variant="body" color="secondary">
                Provider overrides, prompts, and runtime settings used when this template evaluates a generation.
              </Text>
            </div>
            <div className={styles.twoColumnGrid}>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Provider</div>
                <div className={`${styles.valueBlock} ${provider == null ? styles.valueBlockMuted : ''}`}>
                  {provider ?? 'Default'}
                </div>
              </div>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Model</div>
                <div className={`${styles.valueBlock} ${model == null ? styles.valueBlockMuted : ''}`}>
                  {model ?? 'Default'}
                </div>
              </div>
            </div>
            <div className={styles.valueCard}>
              <div className={styles.valueLabel}>System prompt</div>
              <pre className={styles.codeBlock}>
                <code>{highlightTemplateVars(systemPrompt, styles.templateVar)}</code>
              </pre>
            </div>
            <div className={styles.valueCard}>
              <div className={styles.valueLabel}>User prompt</div>
              <pre className={styles.codeBlock}>
                <code>{highlightTemplateVars(userPrompt, styles.templateVar)}</code>
              </pre>
            </div>
            <div className={styles.twoColumnGrid}>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Max tokens</div>
                <div className={styles.valueBlock}>{String(maxTokens)}</div>
              </div>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Temperature</div>
                <div className={styles.valueBlock}>{String(config.temperature ?? 0)}</div>
              </div>
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
                Each response is parsed as JSON and validated against the Sigil built-in schema subset:
                {` ${JSON_SCHEMA_SUPPORTED_KEYWORDS.join(', ')}.`}
              </Text>
            </div>
            <div className={styles.valueCard}>
              <div className={styles.valueLabel}>Schema</div>
              <pre className={styles.codeBlock}>{JSON.stringify(config.schema ?? {}, null, 2)}</pre>
            </div>
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
                Responses are matched against one or more regular expressions.
              </Text>
            </div>
            <div className={styles.valueCard}>
              <div className={styles.valueLabel}>{patternList.length > 0 ? 'Patterns' : 'Pattern'}</div>
              <pre className={styles.codeBlock}>{regexPreview || '—'}</pre>
            </div>
            <div className={styles.valueCard}>
              <div className={styles.valueLabel}>Reject matches</div>
              <div className={styles.valueBlock}>{config.reject ? 'Yes' : 'No'}</div>
            </div>
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
                Simple deterministic checks applied directly to the assistant response.
              </Text>
            </div>
            <div className={styles.twoColumnGrid}>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Not empty</div>
                <div className={styles.valueBlock}>{config.not_empty ? 'Yes' : 'No'}</div>
              </div>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Min length</div>
                <div className={`${styles.valueBlock} ${config.min_length == null ? styles.valueBlockMuted : ''}`}>
                  {config.min_length != null ? String(config.min_length) : '—'}
                </div>
              </div>
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Max length</div>
                <div className={`${styles.valueBlock} ${config.max_length == null ? styles.valueBlockMuted : ''}`}>
                  {config.max_length != null ? String(config.max_length) : '—'}
                </div>
              </div>
            </div>
            {containsValues.length > 0 && (
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Contains</div>
                <pre className={styles.codeBlock}>{formatHeuristicStringList(config.contains)}</pre>
              </div>
            )}
            {notContainsValues.length > 0 && (
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Not contains</div>
                <pre className={styles.codeBlock}>{formatHeuristicStringList(config.not_contains)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {ok && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Output contract</div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.sectionText}>
              <Text variant="body" color="secondary">
                Structured output metadata that defines the score name, type, and pass/fail interpretation.
              </Text>
            </div>
            <div className={styles.outputHeader}>
              <Text weight="medium">{ok.key}</Text>
              <Badge text={ok.type} color="blue" />
              {ok.unit && <Badge text={ok.unit} color="green" />}
            </div>
            {ok.description && (
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Description</div>
                <div className={styles.valueBlock}>{ok.description}</div>
              </div>
            )}

            {ok.type === 'number' && (ok.pass_threshold != null || ok.min != null || ok.max != null) && (
              <div className={styles.constraintsGrid}>
                {ok.pass_threshold != null && (
                  <div className={styles.valueCard}>
                    <div className={styles.valueLabel}>Pass threshold</div>
                    <div className={styles.valueBlock}>{ok.pass_threshold}</div>
                  </div>
                )}
                {ok.min != null && (
                  <div className={styles.valueCard}>
                    <div className={styles.valueLabel}>Min</div>
                    <div className={styles.valueBlock}>{ok.min}</div>
                  </div>
                )}
                {ok.max != null && (
                  <div className={styles.valueCard}>
                    <div className={styles.valueLabel}>Max</div>
                    <div className={styles.valueBlock}>{ok.max}</div>
                  </div>
                )}
              </div>
            )}

            {ok.type === 'string' && (ok.enum?.length ?? 0) > 0 && (
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Allowed values</div>
                <div className={styles.valueBlock}>{ok.enum!.join(', ')}</div>
              </div>
            )}
            {ok.type === 'string' && (ok.pass_match?.length ?? 0) > 0 && (
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Pass values</div>
                <div className={styles.valueBlock}>{ok.pass_match!.join(', ')}</div>
              </div>
            )}
            {ok.type === 'bool' && ok.pass_value != null && (
              <div className={styles.valueCard}>
                <div className={styles.valueLabel}>Pass when</div>
                <div className={styles.valueBlock}>{formatPassValue(ok.pass_value)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
