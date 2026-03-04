import React from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import EvalOnboarding from '../components/evaluation/EvalOnboarding';
import RuleTable from '../components/evaluation/RuleTable';
import SummaryCards from '../components/evaluation/SummaryCards';
import { useEvalRulesDataContext } from '../contexts/EvalRulesDataContext';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

export default function EvaluationOverviewPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage, handleToggle } =
    useEvalRulesDataContext();

  const handleRuleClick = (ruleID: string) => {
    navigate(`${EVAL_BASE}/rules/${encodeURIComponent(ruleID)}`);
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

  const activeRuleCount = rules.filter((r) => r.enabled).length;
  const tenantEvalCount = evaluators.filter((e) => !e.is_predefined).length;
  const hasEvaluators = tenantEvalCount > 0;

  if (rules.length === 0) {
    return (
      <div className={styles.pageContainer}>
        {errorMessage.length > 0 && (
          <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
            <Text>{errorMessage}</Text>
          </Alert>
        )}
        <EvalOnboarding
          hasEvaluators={hasEvaluators}
          onGoToEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
          onGoToCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        />
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

      <SummaryCards
        activeRules={activeRuleCount}
        disabledRules={rules.length - activeRuleCount}
        totalEvaluators={tenantEvalCount}
        predefinedTemplates={predefinedCount}
        onCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        onBrowseEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
      />

      <RuleTable rules={rules} evaluators={evaluators} onToggle={handleToggle} onClick={handleRuleClick} />
    </div>
  );
}
