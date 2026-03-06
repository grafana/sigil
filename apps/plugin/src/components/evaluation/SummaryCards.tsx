import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Stack, Text, useStyles2 } from '@grafana/ui';

export type SummaryCardsProps = {
  activeRules: number;
  disabledRules: number;
  totalEvaluators: number;
  predefinedTemplates: number;
  onBrowseRules?: () => void;
  onBrowseEvaluators?: () => void;
  onBrowseTemplates?: () => void;
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
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(0.75),
      boxShadow: theme.isDark ? '0 8px 20px rgba(0, 0, 0, 0.18)' : '0 8px 18px rgba(15, 23, 42, 0.04)',
    }),
    cardActive: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(115, 191, 105, 0.1), rgba(115, 191, 105, 0.025))'
        : 'linear-gradient(135deg, rgba(115, 191, 105, 0.085), rgba(115, 191, 105, 0.02))',
      borderColor: isDark ? 'rgba(115, 191, 105, 0.22)' : 'rgba(115, 191, 105, 0.24)',
    }),
    cardDisabled: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(255, 152, 48, 0.095), rgba(255, 152, 48, 0.03))'
        : 'linear-gradient(135deg, rgba(255, 152, 48, 0.08), rgba(255, 152, 48, 0.022))',
      borderColor: isDark ? 'rgba(255, 152, 48, 0.2)' : 'rgba(255, 152, 48, 0.22)',
    }),
    cardEvaluators: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(138, 109, 245, 0.1), rgba(138, 109, 245, 0.03))'
        : 'linear-gradient(135deg, rgba(138, 109, 245, 0.085), rgba(138, 109, 245, 0.022))',
      borderColor: isDark ? 'rgba(138, 109, 245, 0.22)' : 'rgba(138, 109, 245, 0.24)',
    }),
    cardTemplates: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.1), rgba(61, 113, 217, 0.03))'
        : 'linear-gradient(135deg, rgba(61, 113, 217, 0.085), rgba(61, 113, 217, 0.022))',
      borderColor: isDark ? 'rgba(61, 113, 217, 0.22)' : 'rgba(61, 113, 217, 0.24)',
    }),
    number: css({
      fontSize: theme.typography.h2.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
    }),
    label: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    description: css({
      color: theme.colors.text.secondary,
      minHeight: theme.spacing(4.5),
      lineHeight: 1.45,
    }),
    cardAction: css({
      marginTop: 'auto',
      display: 'flex',
      paddingTop: theme.spacing(0.5),
    }),
  };
};

export default function SummaryCards({
  activeRules,
  disabledRules,
  totalEvaluators,
  predefinedTemplates,
  onBrowseRules,
  onBrowseEvaluators,
  onBrowseTemplates,
}: SummaryCardsProps) {
  const styles = useStyles2(getStyles);

  return (
    <Stack direction="row" gap={2} wrap="wrap">
      <div className={`${styles.card} ${styles.cardActive}`}>
        <div className={styles.number}>{activeRules}</div>
        <div className={styles.label}>Active rules</div>
        <div className={styles.description}>
          <Text variant="bodySmall">
            {activeRules === 0
              ? 'No traffic is being evaluated yet. Add or enable a rule to start scoring generations.'
              : 'Rules decide which traffic flows into evaluation and which generations get scored.'}
          </Text>
        </div>
        {onBrowseRules != null && (
          <div className={styles.cardAction}>
            <Button variant="secondary" size="sm" onClick={onBrowseRules}>
              Browse rules
            </Button>
          </div>
        )}
      </div>
      <div className={`${styles.card} ${styles.cardDisabled}`}>
        <div className={styles.number}>{disabledRules}</div>
        <div className={styles.label}>Disabled rules</div>
        <div className={styles.description}>
          <Text variant="bodySmall">
            {disabledRules === 0
              ? 'Nothing is currently paused. All configured rules are active.'
              : 'These rules are configured but paused, so they are not currently generating scores.'}
          </Text>
        </div>
        {onBrowseRules != null && (
          <div className={styles.cardAction}>
            <Button variant="secondary" size="sm" onClick={onBrowseRules}>
              {disabledRules > 0 ? 'Review rules' : 'Browse rules'}
            </Button>
          </div>
        )}
      </div>
      <div className={`${styles.card} ${styles.cardEvaluators}`}>
        <div className={styles.number}>{totalEvaluators}</div>
        <div className={styles.label}>Evaluators</div>
        <div className={styles.description}>
          <Text variant="bodySmall">
            {totalEvaluators === 0
              ? 'No tenant evaluators yet. Start from a template to score quality, safety, and behavior.'
              : 'Tenant evaluators turn the behaviors you care about into explicit, queryable signals.'}
          </Text>
        </div>
        {onBrowseEvaluators != null && (
          <div className={styles.cardAction}>
            <Button variant="secondary" size="sm" onClick={onBrowseEvaluators}>
              Browse evaluators
            </Button>
          </div>
        )}
      </div>
      <div className={`${styles.card} ${styles.cardTemplates}`}>
        <div className={styles.number}>{predefinedTemplates}</div>
        <div className={styles.label}>Predefined templates</div>
        <div className={styles.description}>
          <Text variant="bodySmall">
            {predefinedTemplates === 0
              ? 'No built-in templates are available right now.'
              : 'Templates are ready-made evaluator patterns you can fork and adapt to your own use cases.'}
          </Text>
        </div>
        {onBrowseTemplates != null && (
          <div className={styles.cardAction}>
            <Button variant="secondary" size="sm" onClick={onBrowseTemplates}>
              Open library
            </Button>
          </div>
        )}
      </div>
    </Stack>
  );
}
