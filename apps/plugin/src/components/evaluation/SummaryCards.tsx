import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Stack, useStyles2 } from '@grafana/ui';

export type SummaryCardsProps = {
  activeRules: number;
  disabledRules: number;
  totalEvaluators: number;
  predefinedTemplates: number;
  onCreateRule?: () => void;
  onBrowseEvaluators?: () => void;
};

const getStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;

  return {
    card: css({
      flex: 1,
      minWidth: 0,
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    cardActive: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(115, 191, 105, 0.06), rgba(115, 191, 105, 0.02))'
        : 'linear-gradient(135deg, rgba(115, 191, 105, 0.06), rgba(115, 191, 105, 0.02))',
      borderColor: isDark ? 'rgba(115, 191, 105, 0.2)' : 'rgba(115, 191, 105, 0.25)',
    }),
    cardDisabled: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(255, 152, 48, 0.05), rgba(255, 152, 48, 0.02))'
        : 'linear-gradient(135deg, rgba(255, 152, 48, 0.05), rgba(255, 152, 48, 0.02))',
      borderColor: isDark ? 'rgba(255, 152, 48, 0.15)' : 'rgba(255, 152, 48, 0.2)',
    }),
    cardEvaluators: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(138, 109, 245, 0.06), rgba(138, 109, 245, 0.02))'
        : 'linear-gradient(135deg, rgba(138, 109, 245, 0.06), rgba(138, 109, 245, 0.02))',
      borderColor: isDark ? 'rgba(138, 109, 245, 0.2)' : 'rgba(138, 109, 245, 0.25)',
    }),
    cardTemplates: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.06), rgba(61, 113, 217, 0.02))'
        : 'linear-gradient(135deg, rgba(61, 113, 217, 0.06), rgba(61, 113, 217, 0.02))',
      borderColor: isDark ? 'rgba(61, 113, 217, 0.2)' : 'rgba(61, 113, 217, 0.25)',
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
  };
};

export default function SummaryCards({
  activeRules,
  disabledRules,
  totalEvaluators,
  predefinedTemplates,
  onCreateRule,
  onBrowseEvaluators,
}: SummaryCardsProps) {
  const styles = useStyles2(getStyles);

  return (
    <Stack direction="column" gap={2}>
      <Stack direction="row" gap={2} wrap="wrap">
        <div className={`${styles.card} ${styles.cardActive}`}>
          <div className={styles.number}>{activeRules}</div>
          <div className={styles.label}>Active rules</div>
        </div>
        <div className={`${styles.card} ${styles.cardDisabled}`}>
          <div className={styles.number}>{disabledRules}</div>
          <div className={styles.label}>Disabled rules</div>
        </div>
        <div className={`${styles.card} ${styles.cardEvaluators}`}>
          <div className={styles.number}>{totalEvaluators}</div>
          <div className={styles.label}>Evaluators</div>
        </div>
        <div className={`${styles.card} ${styles.cardTemplates}`}>
          <div className={styles.number}>{predefinedTemplates}</div>
          <div className={styles.label}>Predefined templates</div>
        </div>
      </Stack>
      <div className={styles.actions}>
        {onCreateRule != null && (
          <Button icon="plus-circle" variant="primary" onClick={onCreateRule} aria-label="Create rule">
            Create new rule
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
