import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Stack, useStyles2 } from '@grafana/ui';

export type SummaryCardsProps = {
  activeRules: number;
  totalEvaluators: number;
  predefinedTemplates: number;
  onCreateRule?: () => void;
  onBrowseEvaluators?: () => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    flex: 1,
    minWidth: 0,
    padding: theme.spacing(2),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    background: theme.colors.background.primary,
  }),
  number: css({
    fontSize: theme.typography.h2.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
    lineHeight: 1.2,
  }),
  label: css({
    marginTop: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  actions: css({
    marginTop: theme.spacing(2),
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
});

export default function SummaryCards({
  activeRules,
  totalEvaluators,
  predefinedTemplates,
  onCreateRule,
  onBrowseEvaluators,
}: SummaryCardsProps) {
  const styles = useStyles2(getStyles);

  return (
    <Stack direction="column" gap={2}>
      <Stack direction="row" gap={2} wrap="wrap">
        <div className={styles.card}>
          <div className={styles.number}>{activeRules}</div>
          <div className={styles.label}>Active rules</div>
        </div>
        <div className={styles.card}>
          <div className={styles.number}>{totalEvaluators}</div>
          <div className={styles.label}>Evaluators</div>
        </div>
        <div className={styles.card}>
          <div className={styles.number}>{predefinedTemplates}</div>
          <div className={styles.label}>Predefined templates</div>
        </div>
      </Stack>
      <div className={styles.actions}>
        {onCreateRule != null && (
          <Button icon="plus-circle" variant="primary" onClick={onCreateRule} aria-label="Create rule">
            Create Rule
          </Button>
        )}
        {onBrowseEvaluators != null && (
          <Button icon="list-ul" variant="secondary" onClick={onBrowseEvaluators} aria-label="Browse evaluators">
            Browse Evaluators
          </Button>
        )}
      </div>
    </Stack>
  );
}
