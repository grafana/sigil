import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Select, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { CreateTemplateRequest, EvalFormState, TemplateDefinition, TemplateScope } from '../evaluation/types';
import EvalTestPanel from '../components/evaluation/EvalTestPanel';
import TemplateTable from '../components/evaluation/TemplateTable';
import TemplateForm from '../components/evaluation/TemplateForm';

const EVAL_TEMPLATES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/templates`;

export type TemplatesPageProps = {
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
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  controls: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
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

export default function TemplatesPage(props: TemplatesPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formState, setFormState] = useState<EvalFormState>({
    kind: 'llm_judge',
    config: {},
    outputKeys: [{ key: 'score', type: 'number' }],
  });
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

    const scope = scopeFilter ? (scopeFilter as TemplateScope) : undefined;
    dataSource
      .listTemplates(scope)
      .then((res) => {
        if (requestVersion.current !== version) {
          return;
        }
        setTemplates(res.items ?? []);
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load templates');
        setTemplates([]);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource, scopeFilter]);

  const handleSelect = (templateID: string) => {
    navigate(`${EVAL_TEMPLATES_BASE}/${encodeURIComponent(templateID)}`);
  };

  const handleDelete = async (templateID: string) => {
    try {
      await dataSource.deleteTemplate(templateID);
      setTemplates((prev) => prev.filter((t) => t.template_id !== templateID));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  const handleCreateSubmit = async (req: CreateTemplateRequest) => {
    try {
      const created = await dataSource.createTemplate(req);
      setTemplates((prev) => [...prev, created]);
      setShowCreateForm(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create template');
    }
  };

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <Text element="h2">Templates</Text>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <Text element="h2">Templates</Text>
        <div className={styles.controls}>
          <Select
            options={SCOPE_OPTIONS}
            value={scopeFilter}
            onChange={(v) => setScopeFilter(v?.value ?? '')}
            width={16}
          />
          {!showCreateForm && (
            <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)} aria-label="Create template">
              Create Template
            </Button>
          )}
        </div>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      {showCreateForm ? (
        <div className={styles.formWithTest}>
          <div className={styles.formColumn}>
            <TemplateForm
              onSubmit={handleCreateSubmit}
              onCancel={() => setShowCreateForm(false)}
              onConfigChange={setFormState}
            />
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
      ) : templates.length === 0 ? (
        <div className={styles.empty}>
          <Stack direction="column" gap={2} alignItems="center">
            <Text color="secondary">No templates yet.</Text>
            <Button variant="primary" icon="plus" onClick={() => setShowCreateForm(true)}>
              Create your first template
            </Button>
          </Stack>
        </div>
      ) : (
        <TemplateTable templates={templates} onSelect={handleSelect} onDelete={handleDelete} />
      )}
    </div>
  );
}
