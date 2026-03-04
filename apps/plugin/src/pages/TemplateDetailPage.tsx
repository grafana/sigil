import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import {
  EVALUATOR_KIND_LABELS,
  getKindBadgeColor,
  type EvalFormState,
  type ForkTemplateRequest,
  type PublishVersionRequest,
  type TemplateDefinition,
  type TemplateVersion,
} from '../evaluation/types';
import EvalTestPanel from '../components/evaluation/EvalTestPanel';
import VersionHistoryTable from '../components/evaluation/VersionHistoryTable';
import PublishVersionForm from '../components/evaluation/PublishVersionForm';
import VersionCompare from '../components/evaluation/VersionCompare';
import ForkTemplateForm from '../components/evaluation/ForkTemplateForm';

const EVAL_TEMPLATES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/templates`;

export type TemplateDetailPageProps = {
  dataSource?: EvaluationDataSource;
};

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
  titleRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  code: css({
    padding: theme.spacing(1),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'auto',
    whiteSpace: 'pre' as const,
    maxHeight: 300,
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

type ActiveForm = 'none' | 'publish' | 'fork';

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
  const [rollbackVersion, setRollbackVersion] = useState<string | undefined>(undefined);
  const [rollbackConfig, setRollbackConfig] = useState<Record<string, unknown> | undefined>(undefined);
  const [rollbackOutputKeys, setRollbackOutputKeys] = useState<
    Array<{ key: string; type: 'number' | 'bool' | 'string' }> | undefined
  >(undefined);

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

  const handleRollback = async (version: string) => {
    if (!templateID) {
      return;
    }
    try {
      const ver = await dataSource.getTemplateVersion(templateID, version);
      setRollbackVersion(version);
      setRollbackConfig(ver.config);
      setRollbackOutputKeys(ver.output_keys);
      setActiveForm('publish');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load version for rollback');
    }
  };

  const handlePublishSubmit = async (req: PublishVersionRequest) => {
    if (!templateID) {
      return;
    }
    try {
      await dataSource.publishVersion(templateID, req);
      setActiveForm('none');
      setRollbackVersion(undefined);
      setRollbackConfig(undefined);
      setRollbackOutputKeys(undefined);
      setReloadCounter((c) => c + 1);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to publish version');
    }
  };

  const handleForkSubmit = async (req: ForkTemplateRequest) => {
    if (!templateID) {
      return;
    }
    try {
      await dataSource.forkTemplate(templateID, req);
      setActiveForm('none');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fork template');
    }
  };

  const handleDelete = async () => {
    if (!templateID) {
      return;
    }
    try {
      await dataSource.deleteTemplate(templateID);
      navigate(EVAL_TEMPLATES_BASE);
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
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Text element="h2">Template {template.template_id}</Text>
          <Badge text={EVALUATOR_KIND_LABELS[template.kind]} color={getKindBadgeColor(template.kind)} />
          <Badge text={template.scope} color={template.scope === 'global' ? 'orange' : 'blue'} />
        </div>
        <Stack direction="row" gap={1}>
          {template.scope === 'tenant' && (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setRollbackVersion(undefined);
                setRollbackConfig(template.config);
                setRollbackOutputKeys(template.output_keys);
                setActiveForm('publish');
              }}
              disabled={activeForm !== 'none'}
            >
              Publish New Version
            </Button>
          )}
          <Button
            variant="secondary"
            icon="code-branch"
            onClick={() => setActiveForm('fork')}
            disabled={activeForm !== 'none'}
          >
            Fork to Evaluator
          </Button>
          {template.scope === 'tenant' && (
            <Button variant="destructive" icon="trash-alt" onClick={handleDelete}>
              Delete
            </Button>
          )}
        </Stack>
      </div>

      {template.description && <Text color="secondary">{template.description}</Text>}

      <div className={styles.section}>
        <Text element="h3" weight="medium">
          Current Version: {template.latest_version}
        </Text>
        {template.config && <div className={styles.code}>{JSON.stringify(template.config, null, 2)}</div>}
      </div>

      {activeForm === 'publish' && (
        <div className={styles.formWithTest}>
          <div className={styles.formColumn}>
            <PublishVersionForm
              kind={template.kind}
              initialConfig={rollbackConfig}
              initialOutputKeys={rollbackOutputKeys}
              rollbackVersion={rollbackVersion}
              existingVersions={template?.versions?.map((v) => v.version)}
              onSubmit={handlePublishSubmit}
              onCancel={() => {
                setActiveForm('none');
                setRollbackVersion(undefined);
                setRollbackConfig(undefined);
                setRollbackOutputKeys(undefined);
              }}
              onConfigChange={setFormState}
            />
          </div>
          <div className={styles.testColumn}>
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
      )}

      {activeForm === 'fork' && (
        <ForkTemplateForm
          templateID={template.template_id}
          onSubmit={handleForkSubmit}
          onCancel={() => setActiveForm('none')}
          dataSource={dataSource}
        />
      )}

      <div className={styles.section}>
        <Text element="h3" weight="medium">
          Version History
        </Text>
        <VersionHistoryTable
          versions={template.versions ?? []}
          selectedVersions={selectedVersions}
          onToggleSelect={handleToggleVersionSelect}
          onRollback={template.scope === 'tenant' ? handleRollback : undefined}
        />
      </div>

      {compareLeft && compareRight && (
        <div className={styles.section}>
          <Text element="h3" weight="medium">
            Version Compare
          </Text>
          <VersionCompare left={compareLeft} right={compareRight} />
        </div>
      )}
    </div>
  );
}
