import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorDetailProps = {
  evaluator: Evaluator;
};

function highlightTemplateVars(text: string, templateVarClass: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (part.match(/^\{\{[^}]+\}\}$/)) {
      return (
        <span key={i} className={templateVarClass}>
          {part}
        </span>
      );
    }
    return part;
  });
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  header: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  section: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '8px',
    overflow: 'hidden',
  }),
  sectionHeader: css({
    padding: theme.spacing(1, 1.5),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  sectionBody: css({
    padding: theme.spacing(1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    color: theme.colors.text.primary,
  }),
  templateVar: css({
    color: theme.colors.warning.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  outputKeyRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
  }),
});

export default function EvaluatorDetail({ evaluator }: EvaluatorDetailProps) {
  const styles = useStyles2(getStyles);

  const systemPrompt = evaluator.config.system_prompt as string | undefined;
  const userPrompt = evaluator.config.user_prompt as string | undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text element="h2" weight="medium">
          {evaluator.evaluator_id}
        </Text>
        <Badge text={EVALUATOR_KIND_LABELS[evaluator.kind]} color={getKindBadgeColor(evaluator.kind)} />
        <Text color="secondary" variant="bodySmall">
          v{evaluator.version}
        </Text>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text weight="medium" variant="bodySmall">
            Output keys
          </Text>
        </div>
        <div className={styles.sectionBody}>
          {evaluator.output_keys.map((ok) => (
            <div key={ok.key} className={styles.outputKeyRow}>
              <Text variant="bodySmall">{ok.key}</Text>
              <Badge text={ok.type} color="blue" />
              {ok.unit != null && (
                <Text color="secondary" variant="bodySmall">
                  ({ok.unit})
                </Text>
              )}
              {ok.pass_threshold != null && (
                <Text color="secondary" variant="bodySmall">
                  threshold: {ok.pass_threshold}
                </Text>
              )}
            </div>
          ))}
        </div>
      </div>

      {evaluator.kind === 'llm_judge' && (systemPrompt != null || userPrompt != null) && (
        <>
          {systemPrompt != null && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Text weight="medium" variant="bodySmall">
                  System prompt
                </Text>
              </div>
              <pre className={styles.sectionBody}>
                <code>{highlightTemplateVars(systemPrompt, styles.templateVar)}</code>
              </pre>
            </div>
          )}
          {userPrompt != null && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Text weight="medium" variant="bodySmall">
                  User prompt
                </Text>
              </div>
              <pre className={styles.sectionBody}>
                <code>{highlightTemplateVars(userPrompt, styles.templateVar)}</code>
              </pre>
            </div>
          )}
        </>
      )}

      {Object.keys(evaluator.config).length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text weight="medium" variant="bodySmall">
              Full config
            </Text>
          </div>
          <pre className={styles.sectionBody}>{JSON.stringify(evaluator.config, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
