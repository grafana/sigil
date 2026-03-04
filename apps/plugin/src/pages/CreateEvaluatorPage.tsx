import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { CreateEvaluatorRequest, EvalFormState } from '../evaluation/types';
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
    gap: theme.spacing(3),
  }),
  formWithTest: css({
    display: 'grid',
    gridTemplateColumns: '3fr 2fr',
    gap: theme.spacing(3),
  }),
  formColumn: css({
    minWidth: 0,
  }),
  testColumn: css({
    position: 'relative' as const,
    minHeight: 0,
  }),
});

export default function CreateEvaluatorPage(props: CreateEvaluatorPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [formState, setFormState] = useState<EvalFormState>({
    kind: 'llm_judge',
    config: {},
    outputKeys: [{ key: 'score', type: 'number' }],
  });
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (req: CreateEvaluatorRequest) => {
    try {
      await dataSource.createEvaluator(req);
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

      <div className={styles.formWithTest}>
        <div className={styles.formColumn}>
          <EvaluatorForm onSubmit={handleSubmit} onCancel={handleCancel} onConfigChange={setFormState} />
        </div>
        <div className={styles.testColumn}>
          <EvalTestPanel
            kind={formState.kind}
            config={formState.config}
            outputKeys={formState.outputKeys}
            dataSource={dataSource}
          />
        </div>
      </div>
    </div>
  );
}
