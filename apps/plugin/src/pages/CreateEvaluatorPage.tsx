import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { useOptionalEvalRulesDataContext } from '../contexts/EvalRulesDataContext';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { CreateEvaluatorRequest, EvalFormState, Evaluator } from '../evaluation/types';
import EvaluatorForm from '../components/evaluation/EvaluatorForm';
import EvalTestPanel from '../components/evaluation/EvalTestPanel';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

export type CreateEvaluatorPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(3),
  }),
  layout: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 3fr) minmax(360px, 2fr)',
    gridTemplateRows: '1fr',
    gap: theme.spacing(2),
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    '@media (max-width: 1360px)': {
      gridTemplateColumns: '1fr',
      gridTemplateRows: 'auto auto',
      overflow: 'auto',
    },
  }),
  left: css({
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    minWidth: 0,
  }),
  formCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
    padding: 0,
    background: 'transparent',
    minWidth: 0,
  }),
  right: css({
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
    minWidth: 0,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    paddingLeft: theme.spacing(2),
    '@media (max-width: 1360px)': {
      borderLeft: 'none',
      paddingLeft: 0,
    },
  }),
  rightInner: css({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    padding: 0,
  }),
  header: css({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  headerLeft: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    minWidth: 0,
  }),
  headerTitleRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  headerSubtitle: css({
    marginTop: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
  }),
});

export default function CreateEvaluatorPage(props: CreateEvaluatorPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const location = useLocation();
  const evalRulesContext = useOptionalEvalRulesDataContext();

  // When navigating from "Fork template", location.state carries the template data.
  const prefill = useMemo<Partial<Evaluator> | undefined>(() => {
    const s = location.state as { prefill?: Partial<Evaluator> } | null;
    return s?.prefill ?? undefined;
  }, [location.state]);

  const [formState, setFormState] = useState<EvalFormState>({
    kind: 'llm_judge',
    config: {},
    outputKeys: [{ key: 'score', type: 'number' }],
  });
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (req: CreateEvaluatorRequest) => {
    try {
      await dataSource.createEvaluator(req);
      evalRulesContext?.refetch();
      navigate(`${EVAL_BASE}/evaluators`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create evaluator');
    }
  };

  const handleCancel = () => {
    navigate(`${EVAL_BASE}/evaluators`);
  };

  return (
    <div className={styles.page}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div>
            <div className={styles.headerTitleRow}>
              <Text element="h3" weight="bold">
                Create evaluator
              </Text>
              <Badge text="New" color="blue" />
            </div>
            <div className={styles.headerSubtitle}>Define an evaluator and test it against recent generations.</div>
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.left}>
          <div className={styles.formCard}>
            <EvaluatorForm
              prefill={prefill}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              onConfigChange={setFormState}
              dataSource={dataSource}
            />
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.rightInner}>
            <EvalTestPanel
              kind={formState.kind}
              config={formState.config}
              outputKeys={formState.outputKeys}
              dataSource={dataSource}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
