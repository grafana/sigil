import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Select, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type {
  CreateEvaluatorRequest,
  Evaluator,
  ForkTemplateRequest,
  TemplateDefinition,
  TemplateScope,
} from '../evaluation/types';
import EvaluatorDetail from '../components/evaluation/EvaluatorDetail';
import EvaluatorForm from '../components/evaluation/EvaluatorForm';
import EvaluatorTable from '../components/evaluation/EvaluatorTable';
import ForkTemplateForm from '../components/evaluation/ForkTemplateForm';
import TemplateLibraryCard from '../components/evaluation/TemplateLibraryCard';

const EVAL_TEMPLATES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/templates`;

export type EvaluatorsPageProps = {
  dataSource?: EvaluationDataSource;
};

const SCOPE_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'All scopes', value: '' },
  { label: 'Global', value: 'global' },
  { label: 'Tenant', value: 'tenant' },
];

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
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  }),
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [tenantEvaluators, setTenantEvaluators] = useState<Evaluator[]>([]);
  const [selectedEvaluatorID, setSelectedEvaluatorID] = useState<string | null>(null);
  const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(null);
  const [forkTemplateID, setForkTemplateID] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const requestVersion = useRef(0);
  const forkFormRef = useRef<HTMLDivElement>(null);

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

    const scope = scopeFilter ? (scopeFilter as TemplateScope) : undefined;
    Promise.all([dataSource.listEvaluators(), dataSource.listTemplates(scope)])
      .then(([tenantRes, templatesRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setTenantEvaluators(tenantRes.items.filter((e) => !e.is_predefined));
        setTemplates(templatesRes.items ?? []);
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluators');
        setTenantEvaluators([]);
        setTemplates([]);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource, scopeFilter]);

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

  useEffect(() => {
    if (forkTemplateID != null) {
      forkFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [forkTemplateID]);

  const handleForkTemplate = (templateID: string) => {
    setForkTemplateID(templateID);
  };

  const handleForkTemplateSubmit = async (req: ForkTemplateRequest) => {
    if (forkTemplateID == null) {
      return;
    }
    try {
      const created = await dataSource.forkTemplate(forkTemplateID, req);
      setTenantEvaluators((prev) => [...prev, created]);
      setForkTemplateID(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fork template');
    }
  };

  const handleForkCancel = () => {
    setForkTemplateID(null);
  };

  const handleViewTemplate = (templateID: string) => {
    navigate(`${EVAL_TEMPLATES_BASE}/${encodeURIComponent(templateID)}`);
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
        <div className={styles.sectionHeader}>
          <Text element="h3" weight="medium">
            Template Library
          </Text>
          <Select
            options={SCOPE_OPTIONS}
            value={scopeFilter}
            onChange={(v) => setScopeFilter(v?.value ?? '')}
            width={16}
          />
        </div>
        <div className={styles.grid}>
          {templates.map((template) => (
            <TemplateLibraryCard
              key={template.template_id}
              template={template}
              onFork={handleForkTemplate}
              onView={handleViewTemplate}
            />
          ))}
        </div>

        {forkTemplateID != null && (
          <div ref={forkFormRef}>
            <ForkTemplateForm
              templateID={forkTemplateID}
              onSubmit={handleForkTemplateSubmit}
              onCancel={handleForkCancel}
              dataSource={dataSource}
            />
          </div>
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
