import React from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import PipelineCard from '../components/evaluation/PipelineCard';
import { useEvalRulesData } from '../hooks/useEvalRulesData';

const EVAL_RULES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/rules`;

export type RulesPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  ruleList: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  empty: css({
    padding: theme.spacing(4),
    textAlign: 'center' as const,
    color: theme.colors.text.secondary,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

export default function RulesPage(props: RulesPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const { rules, evaluators, loading, errorMessage, setErrorMessage, handleToggle, handleDelete } =
    useEvalRulesData(dataSource);

  const handleClick = (ruleID: string) => {
    navigate(`${EVAL_RULES_BASE}/${ruleID}`);
  };

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <Text element="h2">Rules</Text>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <Text element="h2">Rules</Text>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => navigate(`${EVAL_RULES_BASE}/new`)}
          aria-label="Create rule"
        >
          Create Rule
        </Button>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.ruleList}>
        {rules.length === 0 ? (
          <div className={styles.empty}>
            <Stack direction="column" gap={2} alignItems="center">
              <Text color="secondary">No rules yet.</Text>
              <Button variant="primary" icon="plus" onClick={() => navigate(`${EVAL_RULES_BASE}/new`)}>
                Create your first rule
              </Button>
            </Stack>
          </div>
        ) : (
          rules.map((rule) => (
            <PipelineCard
              key={rule.rule_id}
              rule={rule}
              evaluators={evaluators}
              onToggle={handleToggle}
              onClick={handleClick}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
