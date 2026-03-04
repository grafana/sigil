import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { ForkTemplateRequest } from '../evaluation/types';
import ForkTemplateForm from '../components/evaluation/ForkTemplateForm';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

export type ForkTemplatePageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(3),
    maxWidth: 720,
  }),
});

export default function ForkTemplatePage(props: ForkTemplatePageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const { templateID } = useParams<{ templateID: string }>();
  const effectiveTemplateID = templateID ?? '';

  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (req: ForkTemplateRequest) => {
    if (!effectiveTemplateID) {
      return;
    }
    try {
      await dataSource.forkTemplate(effectiveTemplateID, req);
      navigate(`${EVAL_BASE}/evaluators`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fork template');
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

      <ForkTemplateForm
        templateID={effectiveTemplateID}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        dataSource={dataSource}
      />
    </div>
  );
}
