import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, ConfirmModal, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import {
  buildForkEvaluatorConfig,
  EVALUATOR_KIND_LABELS,
  getKindBadgeColor,
  type EvalFormState,
  type Evaluator,
  type PublishVersionRequest,
  type TemplateDefinition,
  type TemplateVersion,
} from '../evaluation/types';
import EvalTestPanel from '../components/evaluation/EvalTestPanel';
import TemplateConfigSummary from '../components/evaluation/TemplateConfigSummary';
import VersionHistoryTable from '../components/evaluation/VersionHistoryTable';
import PublishVersionForm from '../components/evaluation/PublishVersionForm';
import VersionCompare from '../components/evaluation/VersionCompare';
import { getSectionTitleStyles } from '../components/evaluation/sectionStyles';

const EVAL_TEMPLATES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/templates`;
const EVAL_EVALUATORS_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/evaluators`;

export type TemplateDetailPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(3),
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
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
  formWithTest: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 3fr) minmax(360px, 2fr)',
    gap: theme.spacing(2),
    minHeight: 0,
    overflow: 'hidden',
    '@media (max-width: 1360px)': {
      gridTemplateColumns: '1fr',
      gridTemplateRows: 'auto auto',
      overflow: 'auto',
    },
  }),
  formColumn: css({
    minWidth: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  formCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
    padding: 0,
    background: 'transparent',
    minWidth: 0,
  }),
  testColumn: css({
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    paddingLeft: theme.spacing(2),
    '@media (max-width: 1360px)': {
      borderLeft: 'none',
      paddingLeft: 0,
    },
  }),
  testInner: css({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  }),
  bottomSections: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  detailCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
  }),
  detailCardHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    background: theme.colors.background.primary,
    flexShrink: 0,
    padding: theme.spacing(0.75, 1.25, 0.25),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  detailCardBody: css({
    padding: theme.spacing(1, 1.25),
  }),
  sectionTitle: css({
    ...getSectionTitleStyles(theme),
  }),
});

type ActiveForm = 'none' | 'publish';

export default function TemplateDetailPage(props: TemplateDetailPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const { templateID } = useParams<{ templateID: string }>();

  const [template, setTemplate] = useState<TemplateDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeForm, setActiveForm] = useState<ActiveForm>('none');
  const [formState, setFormState] = useState<EvalFormState | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Version compare state
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [compareLeft, setCompareLeft] = useState<TemplateVersion | null>(null);
  const [compareRight, setCompareRight] = useState<TemplateVersion | null>(null);

  const requestVersion = useRef(0);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!templateID) {
      return;
    }
    requestVersion.current += 1;
    const version = requestVersion.current;

    queueMicrotask(() => {
      if (requestVersion.current !== version) {
        return;
      }
      setLoading(true);
      setErrorMessage('');
    });

    dataSource
      .getTemplate(templateID)
      .then((detail) => {
        if (requestVersion.current !== version) {
          return;
        }
        setTemplate(detail);
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load template');
        setTemplate(null);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource, templateID, reloadCounter]);

  const handleToggleVersionSelect = (version: string) => {
    setSelectedVersions((prev) => {
      if (prev.includes(version)) {
        return prev.filter((v) => v !== version);
      }
      if (prev.length >= 2) {
        return prev;
      }
      return [...prev, version];
    });
  };

  // Load versions for compare when two are selected
  useEffect(() => {
    if (selectedVersions.length !== 2 || !templateID) {
      queueMicrotask(() => {
        setCompareLeft(null);
        setCompareRight(null);
      });
      return;
    }

    let cancelled = false;
    Promise.all([
      dataSource.getTemplateVersion(templateID, selectedVersions[0]),
      dataSource.getTemplateVersion(templateID, selectedVersions[1]),
    ])
      .then(([left, right]) => {
        if (!cancelled) {
          setCompareLeft(left);
          setCompareRight(right);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load versions for compare');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, templateID, selectedVersions]);

  const handlePublishSubmit = async (req: PublishVersionRequest) => {
    if (!templateID) {
      return;
    }
    try {
      await dataSource.publishVersion(templateID, req);
      setActiveForm('none');
      setReloadCounter((c) => c + 1);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to publish version');
    }
  };

  const handleFork = () => {
    if (!template) {
      return;
    }
    const prefill: Partial<Evaluator> = {
      evaluator_id: '',
      kind: template.kind,
      config: buildForkEvaluatorConfig(template.kind, template.config),
      output_keys: template.output_keys ?? [],
      version: '',
    };
    navigate(`${EVAL_EVALUATORS_BASE}/new`, { state: { prefill } });
  };

  const handleDelete = async () => {
    if (!templateID) {
      return;
    }
    try {
      await dataSource.deleteTemplate(templateID);
      navigate(EVAL_EVALUATORS_BASE);
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

  if (!template) {
    return (
      <div className={styles.pageContainer}>
        <Alert severity="error" title="Template not found">
          <Text>Template &quot;{templateID}&quot; could not be found.</Text>
        </Alert>
        <Button variant="secondary" onClick={() => navigate(EVAL_TEMPLATES_BASE)}>
          Back to templates
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete template"
        body={`Are you sure you want to delete template "${templateID}"? This cannot be undone.`}
        confirmText="Delete"
        icon="trash-alt"
        onConfirm={() => {
          setConfirmDelete(false);
          void handleDelete();
        }}
        onDismiss={() => setConfirmDelete(false)}
      />
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
                Template {template.template_id}
              </Text>
              <Badge text={EVALUATOR_KIND_LABELS[template.kind]} color={getKindBadgeColor(template.kind)} />
              <Badge text={template.scope} color={template.scope === 'global' ? 'orange' : 'blue'} />
              <Badge text={`v${template.latest_version}`} color="green" />
            </div>
            {template.description && <div className={styles.headerSubtitle}>{template.description}</div>}
          </div>
        </div>
        <Stack direction="row" gap={1}>
          {template.scope === 'tenant' && (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setActiveForm('publish');
              }}
              disabled={activeForm !== 'none'}
            >
              Publish New Version
            </Button>
          )}
          <Button variant="primary" icon="code-branch" onClick={handleFork}>
            Fork to Evaluator
          </Button>
          {template.scope === 'tenant' && (
            <Button variant="destructive" icon="trash-alt" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </Stack>
      </div>

      {activeForm === 'none' && (
        <TemplateConfigSummary
          kind={template.kind}
          config={template.config ?? {}}
          outputKeys={template.output_keys ?? []}
        />
      )}

      {activeForm === 'publish' && (
        <div className={styles.formWithTest}>
          <div className={styles.formColumn}>
            <div className={styles.formCard}>
              <PublishVersionForm
                kind={template.kind}
                initialConfig={template.config}
                initialOutputKeys={template.output_keys}
                existingVersions={template?.versions?.map((v) => v.version)}
                onSubmit={handlePublishSubmit}
                onCancel={() => {
                  setActiveForm('none');
                }}
                onConfigChange={setFormState}
                dataSource={dataSource}
              />
            </div>
          </div>
          <div className={styles.testColumn}>
            <div className={styles.testInner}>
              {formState && (
                <EvalTestPanel
                  kind={formState.kind}
                  config={formState.config}
                  outputKeys={formState.outputKeys}
                  dataSource={dataSource}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.bottomSections}>
        <div className={styles.detailCard}>
          <div className={styles.detailCardHeader}>
            <div className={styles.sectionTitle}>Version history</div>
          </div>
          <div className={styles.detailCardBody}>
            <VersionHistoryTable
              versions={template.versions ?? []}
              selectedVersions={selectedVersions}
              onToggleSelect={handleToggleVersionSelect}
            />
          </div>
        </div>

        {compareLeft && compareRight && (
          <div className={styles.detailCard}>
            <div className={styles.detailCardHeader}>
              <div className={styles.sectionTitle}>Version compare</div>
            </div>
            <div className={styles.detailCardBody}>
              <VersionCompare
                left={{
                  version: compareLeft.version,
                  changelog: compareLeft.changelog,
                  config: compareLeft.config,
                  outputKeys: compareLeft.output_keys,
                }}
                right={{
                  version: compareRight.version,
                  changelog: compareRight.changelog,
                  config: compareRight.config,
                  outputKeys: compareRight.output_keys,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
