import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Icon, RadioButtonGroup, Select, Spinner, Text, useStyles2, type IconName } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import { fetchAllCursorPages } from '../evaluation/pagination';
import {
  buildForkEvaluatorConfig,
  type Evaluator,
  type TemplateDefinition,
  type TemplateScope,
} from '../evaluation/types';
import { pickLatestVersionPerEvaluator } from '../evaluation/utils';
import EvaluatorTable from '../components/evaluation/EvaluatorTable';
import EvaluatorCardGrid from '../components/evaluation/EvaluatorCardGrid';
import TemplateTable from '../components/evaluation/TemplateTable';
import TemplateCardGrid from '../components/evaluation/TemplateCardGrid';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;
type EvaluatorListView = 'table' | 'cards';
type TemplateListView = 'table' | 'cards';

const SCOPE_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'All scopes', value: '' },
  { label: 'Global', value: 'global' },
  { label: 'Tenant', value: 'tenant' },
];

const EVALUATOR_VIEW_OPTIONS: Array<{ label: string; value: EvaluatorListView }> = [
  { label: 'Table', value: 'table' },
  { label: 'Cards', value: 'cards' },
];

const TEMPLATE_VIEW_OPTIONS: Array<{ label: string; value: TemplateListView }> = [
  { label: 'Table', value: 'table' },
  { label: 'Cards', value: 'cards' },
];

const CARD_PAGE_SIZE_OPTIONS: Array<SelectableValue<number>> = [
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '30', value: 30 },
];

const TABLE_PAGE_SIZE_OPTIONS: Array<SelectableValue<number>> = [
  { label: '25', value: 25 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
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
    sectionDivider: css({
      borderTop: `1px solid ${theme.colors.border.weak}`,
      marginTop: theme.spacing(0.5),
      paddingTop: theme.spacing(3),
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
    evaluatorHeaderControls: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      flexWrap: 'wrap' as const,
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
    paginationBar: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1.5),
      flexWrap: 'wrap' as const,
      paddingTop: theme.spacing(0.5),
    }),
    paginationMeta: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      flexWrap: 'wrap' as const,
      color: theme.colors.text.secondary,
    }),
    paginationControls: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      flexWrap: 'wrap' as const,
    }),
    pageSizeControl: css({
      minWidth: 88,
    }),
  };
};

export default function EvaluatorsPage(props: EvaluatorsPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const templateScopeFilter = searchParams.get('scope') ?? '';
  const evaluatorViewParam = searchParams.get('evaluator_view');
  const templateViewParam = searchParams.get('template_view');
  const setTemplateScopeFilter = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '') {
            next.delete('scope');
          } else {
            next.set('scope', value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const setEvaluatorView = useCallback(
    (value: EvaluatorListView) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('evaluator_view', value);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const setTemplateView = useCallback(
    (value: TemplateListView) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('template_view', value);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [allTemplates, setAllTemplates] = useState<TemplateDefinition[]>([]);
  const [tenantEvaluators, setTenantEvaluators] = useState<Evaluator[]>([]);
  const [evaluatorPage, setEvaluatorPage] = useState(0);
  const [templatePage, setTemplatePage] = useState(0);
  const [evaluatorCardPageSize, setEvaluatorCardPageSize] = useState(10);
  const [evaluatorTablePageSize, setEvaluatorTablePageSize] = useState(25);
  const [templateCardPageSize, setTemplateCardPageSize] = useState(10);
  const [templateTablePageSize, setTemplateTablePageSize] = useState(25);
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
    Promise.all([
      fetchAllCursorPages((cursor) => dataSource.listEvaluators(500, cursor)),
      fetchAllCursorPages((cursor) => dataSource.listTemplates(scope, 500, cursor)),
    ])
      .then(([tenantItems, templateItems]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setTenantEvaluators(pickLatestVersionPerEvaluator(tenantItems.filter((e) => !e.is_predefined)));
        setAllTemplates(templateItems);
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
      return a.scope === 'global' ? -1 : 1;
    }
    return a.template_id.localeCompare(b.template_id);
  });
  const evaluatorView: EvaluatorListView =
    evaluatorViewParam === 'cards' || evaluatorViewParam === 'table' ? evaluatorViewParam : 'cards';
  const templateView: TemplateListView =
    templateViewParam === 'cards' || templateViewParam === 'table' ? templateViewParam : 'cards';
  const activeEvaluatorPageSize = evaluatorView === 'cards' ? evaluatorCardPageSize : evaluatorTablePageSize;
  const activeTemplatePageSize = templateView === 'cards' ? templateCardPageSize : templateTablePageSize;
  const evaluatorPageCount = Math.max(1, Math.ceil(tenantEvaluators.length / activeEvaluatorPageSize));
  const templatePageCount = Math.max(1, Math.ceil(sortedTemplates.length / activeTemplatePageSize));
  const clampedEvaluatorPage = Math.min(evaluatorPage, evaluatorPageCount - 1);
  const clampedTemplatePage = Math.min(templatePage, templatePageCount - 1);
  const visibleEvaluators = useMemo(() => {
    const start = clampedEvaluatorPage * activeEvaluatorPageSize;
    return tenantEvaluators.slice(start, start + activeEvaluatorPageSize);
  }, [activeEvaluatorPageSize, clampedEvaluatorPage, tenantEvaluators]);
  const visibleTemplates = useMemo(() => {
    const start = clampedTemplatePage * activeTemplatePageSize;
    return sortedTemplates.slice(start, start + activeTemplatePageSize);
  }, [activeTemplatePageSize, clampedTemplatePage, sortedTemplates]);

  const handleForkTemplate = async (templateID: string) => {
    try {
      const tmpl = await dataSource.getTemplate(templateID);
      navigate(`${EVAL_BASE}/evaluators/new`, {
        state: {
          prefill: {
            evaluator_id: '',
            kind: tmpl.kind,
            config: buildForkEvaluatorConfig(tmpl.kind, tmpl.config),
            output_keys: tmpl.output_keys ?? [],
            version: '',
          },
        },
      });
    } catch {
      // Fall back to navigating without prefill
      navigate(`${EVAL_BASE}/evaluators/new`);
    }
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

  const evaluatorRangeStart = tenantEvaluators.length === 0 ? 0 : clampedEvaluatorPage * activeEvaluatorPageSize + 1;
  const evaluatorRangeEnd = Math.min((clampedEvaluatorPage + 1) * activeEvaluatorPageSize, tenantEvaluators.length);
  const templateRangeStart = sortedTemplates.length === 0 ? 0 : clampedTemplatePage * activeTemplatePageSize + 1;
  const templateRangeEnd = Math.min((clampedTemplatePage + 1) * activeTemplatePageSize, sortedTemplates.length);

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
          <div className={styles.evaluatorHeaderControls}>
            <RadioButtonGroup options={EVALUATOR_VIEW_OPTIONS} value={evaluatorView} onChange={setEvaluatorView} />
            <Button
              variant="primary"
              icon="plus"
              onClick={() => navigate(`${EVAL_BASE}/evaluators/new`)}
              aria-label="Create evaluator"
            >
              Create Evaluator
            </Button>
          </div>
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
            {evaluatorView === 'cards' ? (
              <EvaluatorCardGrid
                evaluators={visibleEvaluators}
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
            ) : (
              <EvaluatorTable
                evaluators={visibleEvaluators}
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
            )}
            <div className={styles.paginationBar}>
              <div className={styles.paginationMeta}>
                <Text variant="bodySmall" color="secondary">
                  Showing {evaluatorRangeStart}-{evaluatorRangeEnd} of {tenantEvaluators.length}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clampedEvaluatorPage >= evaluatorPageCount - 1}
                  onClick={() => setEvaluatorPage((prev) => Math.min(prev + 1, evaluatorPageCount - 1))}
                >
                  Next
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clampedEvaluatorPage === 0}
                  onClick={() => setEvaluatorPage((prev) => Math.max(prev - 1, 0))}
                >
                  Previous
                </Button>
              </div>
              <div className={styles.paginationControls}>
                <Text variant="bodySmall" color="secondary">
                  Per page
                </Text>
                <Select
                  className={styles.pageSizeControl}
                  options={evaluatorView === 'cards' ? CARD_PAGE_SIZE_OPTIONS : TABLE_PAGE_SIZE_OPTIONS}
                  value={activeEvaluatorPageSize}
                  onChange={(option) => {
                    const nextValue = option?.value;
                    if (typeof nextValue !== 'number') {
                      return;
                    }
                    setEvaluatorPage(0);
                    if (evaluatorView === 'cards') {
                      setEvaluatorCardPageSize(nextValue);
                    } else {
                      setEvaluatorTablePageSize(nextValue);
                    }
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Templates */}
      <div className={`${styles.section} ${styles.sectionDivider}`}>
        <div className={styles.sectionHeader}>
          <Text element="h3" weight="medium">
            Templates
          </Text>
          <div className={styles.headerControls}>
            <RadioButtonGroup options={TEMPLATE_VIEW_OPTIONS} value={templateView} onChange={setTemplateView} />
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
          <>
            {templateView === 'cards' ? (
              <TemplateCardGrid
                templates={visibleTemplates}
                onSelect={handleViewTemplate}
                onDelete={handleDeleteTemplate}
                onFork={handleForkTemplate}
              />
            ) : (
              <TemplateTable
                templates={visibleTemplates}
                onSelect={handleViewTemplate}
                onDelete={handleDeleteTemplate}
                onFork={handleForkTemplate}
              />
            )}
            <div className={styles.paginationBar}>
              <div className={styles.paginationMeta}>
                <Text variant="bodySmall" color="secondary">
                  Showing {templateRangeStart}-{templateRangeEnd} of {sortedTemplates.length}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clampedTemplatePage >= templatePageCount - 1}
                  onClick={() => setTemplatePage((prev) => Math.min(prev + 1, templatePageCount - 1))}
                >
                  Next
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clampedTemplatePage === 0}
                  onClick={() => setTemplatePage((prev) => Math.max(prev - 1, 0))}
                >
                  Previous
                </Button>
              </div>
              <div className={styles.paginationControls}>
                <Text variant="bodySmall" color="secondary">
                  Per page
                </Text>
                <Select
                  className={styles.pageSizeControl}
                  options={templateView === 'cards' ? CARD_PAGE_SIZE_OPTIONS : TABLE_PAGE_SIZE_OPTIONS}
                  value={activeTemplatePageSize}
                  onChange={(option) => {
                    const nextValue = option?.value;
                    if (typeof nextValue !== 'number') {
                      return;
                    }
                    setTemplatePage(0);
                    if (templateView === 'cards') {
                      setTemplateCardPageSize(nextValue);
                    } else {
                      setTemplateTablePageSize(nextValue);
                    }
                  }}
                />
              </div>
            </div>
          </>
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
