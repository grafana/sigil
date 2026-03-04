import React from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Icon, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import RuleTable from '../components/evaluation/RuleTable';
import { useEvalRulesDataContext } from '../contexts/EvalRulesDataContext';

const EVAL_RULES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/rules`;

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(3),
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  }),
  sectionDescription: css({
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(-1),
  }),
  empty: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(6, 4),
    gap: theme.spacing(3),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
  }),
  emptyVisual: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  emptyNode: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.disabled,
  }),
  emptyNodeCenter: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: theme.shape.radius.default,
    background: theme.isDark
      ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.15), rgba(61, 113, 217, 0.05))'
      : 'linear-gradient(135deg, rgba(61, 113, 217, 0.1), rgba(61, 113, 217, 0.03))',
    border: `1px solid ${theme.colors.primary.border}`,
    color: theme.colors.primary.text,
  }),
  emptyArrow: css({
    color: theme.colors.border.medium,
    flexShrink: 0,
  }),
  emptyText: css({
    textAlign: 'center' as const,
    maxWidth: 400,
  }),
  emptyHints: css({
    display: 'flex',
    gap: theme.spacing(3),
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
  }),
  emptyHint: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

export default function RulesPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const { rules, evaluators, loading, errorMessage, setErrorMessage, handleToggle } = useEvalRulesDataContext();

  const handleClick = (ruleID: string) => {
    navigate(`${EVAL_RULES_BASE}/${encodeURIComponent(ruleID)}`);
  };

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text element="h3" weight="medium">
            Rules
          </Text>
          {rules.length > 0 && (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => navigate(`${EVAL_RULES_BASE}/new`)}
              aria-label="Create rule"
            >
              Create new rule
            </Button>
          )}
        </div>
        <div className={styles.sectionDescription}>
          <Text variant="bodySmall" color="secondary">
            Rules connect selectors, match criteria, and evaluators into an automated pipeline that scores your LLM
            generations.
          </Text>
        </div>

        {rules.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyVisual}>
              <div className={styles.emptyNode}>
                <Icon name="filter" size="xl" />
              </div>
              <Icon name="arrow-right" size="md" className={styles.emptyArrow} />
              <div className={styles.emptyNodeCenter}>
                <Icon name="sliders-v-alt" size="xl" />
              </div>
              <Icon name="arrow-right" size="md" className={styles.emptyArrow} />
              <div className={styles.emptyNode}>
                <Icon name="check-circle" size="xl" />
              </div>
            </div>
            <div className={styles.emptyText}>
              <Text element="h4" weight="medium">
                Build your evaluation pipeline
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text color="secondary" variant="body">
                  Define which generations to evaluate and how they are scored in real time.
                </Text>
              </div>
            </div>
            <div className={styles.emptyHints}>
              <span className={styles.emptyHint}>
                <Icon name="filter" size="sm" /> Select generations
              </span>
              <span className={styles.emptyHint}>
                <Icon name="percentage" size="sm" /> Sample traffic
              </span>
              <span className={styles.emptyHint}>
                <Icon name="check-circle" size="sm" /> Run evaluators
              </span>
            </div>
            <Button variant="primary" icon="plus" onClick={() => navigate(`${EVAL_RULES_BASE}/new`)}>
              Create your first rule
            </Button>
          </div>
        ) : (
          <RuleTable rules={rules} evaluators={evaluators} onToggle={handleToggle} onClick={handleClick} />
        )}
      </div>
    </div>
  );
}
