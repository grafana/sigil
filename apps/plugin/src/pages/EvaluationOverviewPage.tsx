import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, RadioButtonGroup, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import PipelineCard from '../components/evaluation/PipelineCard';
import SummaryCards from '../components/evaluation/SummaryCards';
import { useEvalRulesData } from '../hooks/useEvalRulesData';

export type EvaluationOverviewPageProps = {
  dataSource?: EvaluationDataSource;
};

type ViewMode = 'pipeline' | 'summary';

const VIEW_OPTIONS: Array<SelectableValue<ViewMode>> = [
  { label: 'Pipeline', value: 'pipeline' },
  { label: 'Summary', value: 'summary' },
];

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

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

export default function EvaluationOverviewPage(props: EvaluationOverviewPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage, handleToggle, handleDelete } =
    useEvalRulesData(dataSource);

  const handleRuleClick = (ruleID: string) => {
    navigate(`${EVAL_BASE}/rules/${ruleID}`);
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

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <RadioButtonGroup options={VIEW_OPTIONS} value={viewMode} onChange={(v) => setViewMode(v)} />
        <Stack direction="row" gap={1}>
          <Button variant="primary" icon="plus" onClick={() => navigate(`${EVAL_BASE}/rules/new`)}>
            Create Rule
          </Button>
          <Button variant="secondary" onClick={() => navigate(`${EVAL_BASE}/evaluators`)}>
            Browse Evaluators
          </Button>
        </Stack>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      {viewMode === 'summary' && (
        <SummaryCards
          activeRules={activeRuleCount}
          totalEvaluators={tenantEvalCount}
          predefinedTemplates={predefinedCount}
          onCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
          onBrowseEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
        />
      )}

      {viewMode === 'pipeline' && (
        <div className={styles.ruleList}>
          {rules.length === 0 ? (
            <div className={styles.empty}>
              <Stack direction="column" gap={2} alignItems="center">
                <Text color="secondary">No rules configured yet.</Text>
                <Button variant="primary" icon="plus" onClick={() => navigate(`${EVAL_BASE}/rules/new`)}>
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
                onClick={handleRuleClick}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
