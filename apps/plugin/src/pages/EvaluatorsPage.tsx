import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { CreateEvaluatorRequest, Evaluator, ForkEvaluatorRequest } from '../evaluation/types';
import EvaluatorDetail from '../components/evaluation/EvaluatorDetail';
import EvaluatorForm from '../components/evaluation/EvaluatorForm';
import EvaluatorTable from '../components/evaluation/EvaluatorTable';
import EvaluatorTemplateGrid from '../components/evaluation/EvaluatorTemplateGrid';
import ForkEvaluatorForm from '../components/evaluation/ForkEvaluatorForm';

export type EvaluatorsPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

export default function EvaluatorsPage(props: EvaluatorsPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);

  const [predefinedEvaluators, setPredefinedEvaluators] = useState<Evaluator[]>([]);
  const [tenantEvaluators, setTenantEvaluators] = useState<Evaluator[]>([]);
  const [selectedEvaluatorID, setSelectedEvaluatorID] = useState<string | null>(null);
  const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(null);
  const [forkTemplateID, setForkTemplateID] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
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

    Promise.all([dataSource.listPredefinedEvaluators(), dataSource.listEvaluators()])
      .then(([predefinedRes, tenantRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setPredefinedEvaluators(predefinedRes.items);
        setTenantEvaluators(tenantRes.items.filter((e) => !e.is_predefined));
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluators');
        setPredefinedEvaluators([]);
        setTenantEvaluators([]);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource]);

  useEffect(() => {
    if (selectedEvaluatorID == null) {
      queueMicrotask(() => setSelectedEvaluator(null));
      return;
    }
    const found = tenantEvaluators.find((e) => e.evaluator_id === selectedEvaluatorID);
    if (found != null) {
      queueMicrotask(() => setSelectedEvaluator(found));
      return;
    }
    void dataSource
      .getEvaluator(selectedEvaluatorID)
      .then((e) => setSelectedEvaluator(e))
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluator');
      });
  }, [dataSource, selectedEvaluatorID, tenantEvaluators]);

  const handleFork = (evaluatorID: string) => {
    setForkTemplateID(evaluatorID);
  };

  const handleForkSubmit = async (req: ForkEvaluatorRequest) => {
    if (forkTemplateID == null) {
      return;
    }
    try {
      const created = await dataSource.forkPredefinedEvaluator(forkTemplateID, req);
      setTenantEvaluators((prev) => [...prev, created]);
      setForkTemplateID(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fork evaluator');
    }
  };

  const handleForkCancel = () => {
    setForkTemplateID(null);
  };

  const handleCreateSubmit = async (req: CreateEvaluatorRequest) => {
    try {
      const created = await dataSource.createEvaluator(req);
      setTenantEvaluators((prev) => [...prev, created]);
      setShowCreateForm(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create evaluator');
    }
  };

  const handleCreateCancel = () => {
    setShowCreateForm(false);
  };

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <Text element="h2">Evaluators</Text>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <Text element="h2">Evaluators</Text>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.section}>
        <Text element="h3" weight="medium">
          Template Library
        </Text>
        <EvaluatorTemplateGrid evaluators={predefinedEvaluators} onFork={handleFork} />

        {forkTemplateID != null && (
          <Stack direction="column" gap={2}>
            <ForkEvaluatorForm
              templateID={forkTemplateID}
              onSubmit={handleForkSubmit}
              onCancel={handleForkCancel}
              dataSource={dataSource}
            />
          </Stack>
        )}
      </div>

      <div className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <Text element="h3" weight="medium">
            Your Evaluators
          </Text>
          {!showCreateForm && (
            <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)} aria-label="Create custom">
              Create Custom
            </Button>
          )}
        </div>

        {showCreateForm ? (
          <EvaluatorForm onSubmit={handleCreateSubmit} onCancel={handleCreateCancel} />
        ) : (
          <>
            <EvaluatorTable
              evaluators={tenantEvaluators}
              onSelect={setSelectedEvaluatorID}
              onDelete={async (id) => {
                try {
                  await dataSource.deleteEvaluator(id);
                  setTenantEvaluators((prev) => prev.filter((e) => e.evaluator_id !== id));
                  if (selectedEvaluatorID === id) {
                    setSelectedEvaluatorID(null);
                  }
                } catch (err) {
                  setErrorMessage(err instanceof Error ? err.message : 'Failed to delete evaluator');
                }
              }}
            />
            {selectedEvaluator != null && <EvaluatorDetail evaluator={selectedEvaluator} />}
          </>
        )}
      </div>
    </div>
  );
}
