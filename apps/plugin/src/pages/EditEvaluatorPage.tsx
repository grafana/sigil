import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { CreateEvaluatorRequest, EvalFormState, Evaluator, TemplateVersionSummary } from '../evaluation/types';
import EvaluatorForm from '../components/evaluation/EvaluatorForm';
import EvalTestPanel from '../components/evaluation/EvalTestPanel';
import VersionHistoryTable from '../components/evaluation/VersionHistoryTable';
import VersionCompare from '../components/evaluation/VersionCompare';
import { getSectionTitleStyles } from '../components/evaluation/sectionStyles';
import { useOptionalEvalRulesDataContext } from '../contexts/EvalRulesDataContext';

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
    gridTemplateColumns: 'minmax(0, 3fr) minmax(360px, 2fr)',
    gridTemplateRows: '1fr',
    gap: theme.spacing(2),
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    '@media (max-width: 1360px)': {
      gridTemplateColumns: '1fr',
      gridTemplateRows: 'auto auto',
      overflow: 'auto',
    },
  }),
  left: css({
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    minHeight: 0,
    minWidth: 0,
  }),
  formCard: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
    padding: 0,
    background: 'transparent',
    minWidth: 0,
  }),
  right: css({
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
    minWidth: 0,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    paddingLeft: theme.spacing(2),
    '@media (max-width: 1360px)': {
      borderLeft: 'none',
      paddingLeft: 0,
    },
  }),
  rightInner: css({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    padding: 0,
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
  sectionTitle: css({
    ...getSectionTitleStyles(theme),
  }),
  detailCardBody: css({
    padding: theme.spacing(1, 1.25),
  }),
});

export default function EditEvaluatorPage(props: EditEvaluatorPageProps) {
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const { evaluatorID } = useParams<{ evaluatorID: string }>();
  const evalRulesContext = useOptionalEvalRulesDataContext();

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

  const handleSubmit = async (req: CreateEvaluatorRequest) => {
    try {
      await dataSource.createEvaluator(req);
      evalRulesContext?.refetch();
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
              <Badge text={evaluator.version} color="blue" />
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
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.rightInner}>
            <EvalTestPanel
              kind={formState.kind}
              config={formState.config}
              outputKeys={formState.outputKeys}
              dataSource={dataSource}
            />
          </div>
        </div>
      </div>

      <div className={styles.bottomSections}>
        <div className={styles.detailCard}>
          <div className={styles.detailCardHeader}>
            <div className={styles.sectionTitle}>Version history</div>
          </div>
          <div className={styles.detailCardBody}>
            <VersionHistoryTable
              versions={versions}
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
                  changelog: '',
                  config: compareLeft.config ?? {},
                  outputKeys: compareLeft.output_keys,
                }}
                right={{
                  version: compareRight.version,
                  changelog: '',
                  config: compareRight.config ?? {},
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
