import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, RadioButtonGroup, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { Evaluator, Rule } from '../evaluation/types';
import PipelineCard from '../components/evaluation/PipelineCard';
import SummaryCards from '../components/evaluation/SummaryCards';

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
  const [rules, setRules] = useState<Rule[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [predefinedCount, setPredefinedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    requestVersion.current += 1;
    const version = requestVersion.current;

    queueMicrotask(() => {
      if (requestVersion.current !== version) {
        return;
      }
      setLoading(true);
      setErrorMessage('');
    });

    Promise.all([dataSource.listRules(), dataSource.listEvaluators(), dataSource.listPredefinedEvaluators()])
      .then(([rulesRes, evaluatorsRes, predefinedRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setRules(rulesRes.items);
        setEvaluators([...evaluatorsRes.items, ...predefinedRes.items]);
        setPredefinedCount(predefinedRes.items.length);
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluation data');
        setRules([]);
        setEvaluators([]);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource]);

  const handleToggle = async (ruleID: string, enabled: boolean) => {
    try {
      const updated = await dataSource.updateRule(ruleID, { enabled });
      setRules((prev) => prev.map((r) => (r.rule_id === ruleID ? updated : r)));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleDelete = async (ruleID: string) => {
    try {
      await dataSource.deleteRule(ruleID);
      setRules((prev) => prev.filter((r) => r.rule_id !== ruleID));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

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
