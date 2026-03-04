import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Icon, Select, Spinner, Text, useStyles2, type IconName } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { Evaluator, TemplateDefinition, TemplateScope } from '../evaluation/types';
import { pickLatestVersionPerEvaluator } from '../evaluation/utils';
import EvaluatorTable from '../components/evaluation/EvaluatorTable';
import TemplateTable from '../components/evaluation/TemplateTable';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

const SCOPE_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'All scopes', value: '' },
  { label: 'Global', value: 'global' },
  { label: 'Tenant', value: 'tenant' },
];

export type EvaluatorsPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  return {
    pageContainer: css({
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100%',
      gap: theme.spacing(3),
    }),
    section: css({
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(2),
    }),
    sectionHeader: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(2),
    }),
    headerControls: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    sectionDescription: css({
      color: theme.colors.text.secondary,
      marginTop: theme.spacing(-1),
    }),
    loading: css({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing(4),
    }),
    emptyCard: css({
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: theme.spacing(2.5),
      padding: theme.spacing(5, 4),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      transition: 'border-color 0.2s, box-shadow 0.2s',
      '&:hover': {
        borderColor: theme.colors.border.medium,
        boxShadow: theme.shadows.z1,
      },
    }),
    emptyIcon: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 48,
      height: 48,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    emptyIconEval: css({
      background: isDark ? 'rgba(138, 109, 245, 0.1)' : 'rgba(138, 109, 245, 0.08)',
      color: 'rgb(138, 109, 245)',
    }),
    emptyIconTemplate: css({
      background: isDark ? 'rgba(61, 113, 217, 0.1)' : 'rgba(61, 113, 217, 0.08)',
      color: 'rgb(61, 113, 217)',
    }),
    emptyTitle: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    emptyDescription: css({
      maxWidth: 460,
      textAlign: 'center' as const,
      color: theme.colors.text.secondary,
      lineHeight: 1.6,
    }),
    emptyFeatures: css({
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1),
      marginTop: theme.spacing(0.5),
    }),
    emptyFeature: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    featureIcon: css({
      flexShrink: 0,
      color: theme.colors.text.disabled,
    }),
  };
};

export default function EvaluatorsPage(props: EvaluatorsPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [allTemplates, setAllTemplates] = useState<TemplateDefinition[]>([]);
  const [tenantEvaluators, setTenantEvaluators] = useState<Evaluator[]>([]);
  const [templateScopeFilter, setTemplateScopeFilter] = useState<string>('');
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

    const scope = templateScopeFilter ? (templateScopeFilter as TemplateScope) : undefined;
    Promise.all([dataSource.listEvaluators(), dataSource.listTemplates(scope)])
      .then(([tenantRes, templatesRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setTenantEvaluators(pickLatestVersionPerEvaluator(tenantRes.items.filter((e) => !e.is_predefined)));
        setAllTemplates(templatesRes.items ?? []);
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluators');
        setTenantEvaluators([]);
        setAllTemplates([]);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource, templateScopeFilter]);

  const sortedTemplates = [...allTemplates].sort((a, b) => {
    if (a.scope !== b.scope) {
      return a.scope === 'tenant' ? -1 : 1;
    }
    return a.template_id.localeCompare(b.template_id);
  });

  const handleForkTemplate = (templateID: string) => {
    navigate(`${EVAL_BASE}/templates/${encodeURIComponent(templateID)}/fork`);
  };

  const handleViewTemplate = (templateID: string) => {
    navigate(`${EVAL_BASE}/templates/${encodeURIComponent(templateID)}`);
  };

  const handleDeleteTemplate = async (templateID: string) => {
    try {
      await dataSource.deleteTemplate(templateID);
      setAllTemplates((prev) => prev.filter((t) => t.template_id !== templateID));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete template');
    }
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

  return (
    <div className={styles.pageContainer}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      {/* Your Evaluators */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text element="h3" weight="medium">
            Your Evaluators
          </Text>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate(`${EVAL_BASE}/evaluators/new`)}
            aria-label="Create evaluator"
          >
            Create Evaluator
          </Button>
        </div>
        <div className={styles.sectionDescription}>
          <Text variant="bodySmall" color="secondary">
            Custom evaluators you have created or forked from the template library.
          </Text>
        </div>

        {tenantEvaluators.length === 0 ? (
          <EvaluatorsEmptyState onCreateEvaluator={() => navigate(`${EVAL_BASE}/evaluators/new`)} />
        ) : (
          <>
            <EvaluatorTable
              evaluators={tenantEvaluators}
              onSelect={(id) => navigate(`${EVAL_BASE}/evaluators/${encodeURIComponent(id)}/edit`)}
              onDelete={async (id) => {
                try {
                  await dataSource.deleteEvaluator(id);
                  setTenantEvaluators((prev) => prev.filter((e) => e.evaluator_id !== id));
                } catch (err) {
                  setErrorMessage(err instanceof Error ? err.message : 'Failed to delete evaluator');
                }
              }}
            />
          </>
        )}
      </div>

      {/* Templates */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text element="h3" weight="medium">
            Templates
          </Text>
          <div className={styles.headerControls}>
            <Select
              options={SCOPE_OPTIONS}
              value={templateScopeFilter}
              onChange={(v) => setTemplateScopeFilter(v?.value ?? '')}
              width={16}
            />
            <Button
              variant="primary"
              icon="plus"
              onClick={() => navigate(`${EVAL_BASE}/templates/new`)}
              aria-label="Create template"
            >
              Create Template
            </Button>
          </div>
        </div>
        <div className={styles.sectionDescription}>
          <Text variant="bodySmall" color="secondary">
            Pre-built and custom evaluator templates. Fork a global template to create an evaluator, or create your own
            reusable template.
          </Text>
        </div>

        {sortedTemplates.length === 0 ? (
          <TemplatesEmptyState onCreateTemplate={() => navigate(`${EVAL_BASE}/templates/new`)} />
        ) : (
          <TemplateTable
            templates={sortedTemplates}
            onSelect={handleViewTemplate}
            onDelete={handleDeleteTemplate}
            onFork={handleForkTemplate}
          />
        )}
      </div>
    </div>
  );
}

const EVAL_TYPE_HINTS: Array<{ icon: IconName; label: string }> = [
  { icon: 'brain', label: 'LLM Judge — score quality, relevance, safety' },
  { icon: 'brackets-curly', label: 'JSON Schema — validate structured output' },
  { icon: 'code-branch', label: 'Regex — pattern-match on content' },
  { icon: 'check-square', label: 'Heuristic — length checks, non-empty' },
];

function EvaluatorsEmptyState({ onCreateEvaluator }: { onCreateEvaluator: () => void }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.emptyCard}>
      <div className={`${styles.emptyIcon} ${styles.emptyIconEval}`}>
        <Icon name="check-circle" size="xl" />
      </div>
      <span className={styles.emptyTitle}>No evaluators yet</span>
      <div className={styles.emptyDescription}>
        <Text variant="body" color="secondary">
          Create a custom evaluator or fork one from the template library below to start scoring your LLM generations.
        </Text>
      </div>
      <div className={styles.emptyFeatures}>
        {EVAL_TYPE_HINTS.map((h) => (
          <div key={h.label} className={styles.emptyFeature}>
            <Icon name={h.icon} size="sm" className={styles.featureIcon} />
            <span>{h.label}</span>
          </div>
        ))}
      </div>
      <Button variant="primary" icon="plus" onClick={onCreateEvaluator}>
        Create Evaluator
      </Button>
    </div>
  );
}

const TEMPLATE_HINTS: Array<{ icon: IconName; label: string }> = [
  { icon: 'copy', label: 'Reusable across multiple evaluators' },
  { icon: 'history', label: 'Versioned with changelog tracking' },
  { icon: 'users-alt', label: 'Shareable across your organization' },
];

function TemplatesEmptyState({ onCreateTemplate }: { onCreateTemplate: () => void }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.emptyCard}>
      <div className={`${styles.emptyIcon} ${styles.emptyIconTemplate}`}>
        <Icon name="document-info" size="xl" />
      </div>
      <span className={styles.emptyTitle}>No templates yet</span>
      <div className={styles.emptyDescription}>
        <Text variant="body" color="secondary">
          Create a template to define a reusable evaluator configuration that can be versioned and shared.
        </Text>
      </div>
      <div className={styles.emptyFeatures}>
        {TEMPLATE_HINTS.map((h) => (
          <div key={h.label} className={styles.emptyFeature}>
            <Icon name={h.icon} size="sm" className={styles.featureIcon} />
            <span>{h.label}</span>
          </div>
        ))}
      </div>
      <Button variant="primary" icon="plus" onClick={onCreateTemplate}>
        Create Template
      </Button>
    </div>
  );
}
