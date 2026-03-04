import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { CreateEvaluatorRequest, EvalFormState, Evaluator, TemplateVersionSummary } from '../evaluation/types';
import EvaluatorForm from '../components/evaluation/EvaluatorForm';
import EvalTestPanel from '../components/evaluation/EvalTestPanel';
import VersionHistoryTable from '../components/evaluation/VersionHistoryTable';
import VersionCompare from '../components/evaluation/VersionCompare';
import RevertEvaluatorForm from '../components/evaluation/RevertEvaluatorForm';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

export type EditEvaluatorPageProps = {
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
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: '1fr',
    gap: theme.spacing(3),
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  left: css({
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    minHeight: 0,
    padding: theme.spacing(0.5),
    paddingLeft: 0,
  }),
  formCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
    borderRadius: theme.shape.radius.default,
  }),
  right: css({
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
  }),
  rightInner: css({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    padding: theme.spacing(0.5, 0, 2, 2),
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
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(6),
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  versionHistoryCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
    borderRadius: theme.shape.radius.default,
  }),
});

export default function EditEvaluatorPage(props: EditEvaluatorPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const { evaluatorID } = useParams<{ evaluatorID: string }>();

  const [evaluator, setEvaluator] = useState<Awaited<ReturnType<typeof dataSource.getEvaluator>> | null>(null);
  const [formState, setFormState] = useState<EvalFormState>({
    kind: 'llm_judge',
    config: {},
    outputKeys: [{ key: 'score', type: 'number' }],
  });
  const [loading, setLoading] = useState(() => Boolean(evaluatorID));
  const [errorMessage, setErrorMessage] = useState('');
  const [versions, setVersions] = useState<TemplateVersionSummary[]>([]);
  const [versionDetails, setVersionDetails] = useState<Evaluator[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [rollbackEvaluator, setRollbackEvaluator] = useState<Evaluator | null>(null);

  useEffect(() => {
    if (!evaluatorID) {
      return;
    }
    queueMicrotask(() => {
      setLoading(true);
      setErrorMessage('');
    });
    dataSource
      .getEvaluator(evaluatorID)
      .then(setEvaluator)
      .catch((err) => setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluator'))
      .finally(() => setLoading(false));
  }, [dataSource, evaluatorID]);

  useEffect(() => {
    if (!evaluator) {
      queueMicrotask(() => {
        setVersions([]);
        setVersionDetails([]);
      });
      return;
    }
    let cancelled = false;
    const targetId = evaluator.evaluator_id;
    let cursor: string | undefined;
    const all: Evaluator[] = [];
    const fetchPage = (): Promise<void> =>
      dataSource.listEvaluators(200, cursor).then((res) => {
        if (cancelled) {
          return;
        }
        for (const e of res.items) {
          if (e.evaluator_id === targetId) {
            all.push(e);
          }
        }
        if (res.next_cursor) {
          cursor = res.next_cursor;
          return fetchPage();
        }
        if (cancelled) {
          return;
        }
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setVersionDetails(all);
        setVersions(
          all.map((e) => ({
            version: e.version,
            changelog: '—',
            created_at: e.created_at,
          }))
        );
        return;
      });
    fetchPage().catch(() => {
      if (!cancelled) {
        setVersions([]);
        setVersionDetails([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, evaluator]);

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

  const compareLeft = selectedVersions[0]
    ? (versionDetails.find((e) => e.version === selectedVersions[0]) ?? null)
    : null;
  const compareRight = selectedVersions[1]
    ? (versionDetails.find((e) => e.version === selectedVersions[1]) ?? null)
    : null;

  const handleRollback = (version: string) => {
    const e = versionDetails.find((ev) => ev.version === version);
    if (e) {
      setRollbackEvaluator(e);
    }
  };

  // When rollback form is shown, use rollback evaluator's config for the test panel.
  // When editing, use formState from EvaluatorForm's onConfigChange.
  const testPanelState: EvalFormState = rollbackEvaluator
    ? {
        kind: rollbackEvaluator.kind,
        config: rollbackEvaluator.config ?? {},
        outputKeys: rollbackEvaluator.output_keys ?? [],
      }
    : formState;

  const handleRevertSubmit = async (req: CreateEvaluatorRequest) => {
    if (!evaluator) {
      return;
    }
    try {
      await dataSource.createEvaluator(req);
      navigate(`${EVAL_BASE}/evaluators`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to revert');
    }
  };

  const handleSubmit = async (req: CreateEvaluatorRequest) => {
    try {
      await dataSource.createEvaluator(req);
      navigate(`${EVAL_BASE}/evaluators`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update evaluator');
    }
  };

  const handleCancel = () => {
    navigate(`${EVAL_BASE}/evaluators`);
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Text element="h3" weight="bold">
            Edit evaluator
          </Text>
        </div>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (errorMessage && !evaluator) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Text element="h3" weight="bold">
            Edit evaluator
          </Text>
        </div>
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      </div>
    );
  }

  if (!evaluator) {
    return (
      <div className={styles.page}>
        <Alert severity="warning" title="Not found">
          <Text>Evaluator not found.</Text>
        </Alert>
      </div>
    );
  }

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
                Edit evaluator {evaluator.evaluator_id}
              </Text>
            </div>
            <div className={styles.headerSubtitle}>
              Update the evaluator configuration and test it against recent generations.
            </div>
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.left}>
          <div className={styles.formCard}>
            {rollbackEvaluator ? (
              <RevertEvaluatorForm
                evaluator={rollbackEvaluator}
                existingVersions={versions.map((v) => v.version)}
                onSubmit={handleRevertSubmit}
                onCancel={() => setRollbackEvaluator(null)}
              />
            ) : (
              <EvaluatorForm
                key={evaluator.evaluator_id}
                initialEvaluator={evaluator}
                existingVersions={
                  versions.length > 0 ? versions.map((v) => v.version) : evaluator ? [evaluator.version] : []
                }
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                onConfigChange={setFormState}
              />
            )}
          </div>

          <div className={styles.versionHistoryCard}>
            <Text element="h3" weight="medium">
              Version History
            </Text>
            <VersionHistoryTable
              versions={versions}
              selectedVersions={selectedVersions}
              onToggleSelect={handleToggleVersionSelect}
              onRollback={handleRollback}
            />
          </div>

          {compareLeft && compareRight && (
            <div className={styles.section}>
              <Text element="h3" weight="medium">
                Version Compare
              </Text>
              <VersionCompare
                left={{
                  version: compareLeft.version,
                  changelog: '',
                  config: compareLeft.config ?? {},
                }}
                right={{
                  version: compareRight.version,
                  changelog: '',
                  config: compareRight.config ?? {},
                }}
              />
            </div>
          )}
        </div>
        <div className={styles.right}>
          <div className={styles.rightInner}>
            <EvalTestPanel
              kind={testPanelState.kind}
              config={testPanelState.config}
              outputKeys={testPanelState.outputKeys}
              dataSource={dataSource}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
