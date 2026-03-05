import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { useOptionalEvalRulesDataContext } from '../contexts/EvalRulesDataContext';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import { isValidResourceID, pickLatestVersionPerEvaluator } from '../evaluation/utils';
import type {
  CreateRuleRequest,
  Evaluator,
  RulePreviewResponse,
  RuleSelector,
  UpdateRuleRequest,
} from '../evaluation/types';
import DryRunPreview from '../components/evaluation/DryRunPreview';
import RuleEnableToggle from '../components/evaluation/RuleEnableToggle';
import RuleForm from '../components/evaluation/RuleForm';

const PREVIEW_DEBOUNCE_MS = 500;

export type RuleDetailPageProps = {
  dataSource?: EvaluationDataSource;
  ruleID?: string;
  onNavigateBack?: () => void;
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
    fontSize: theme.typography.bodySmall.fontSize,
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
  actions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(6),
  }),
});

export default function RuleDetailPage(props: RuleDetailPageProps) {
  const { ruleID: propRuleID, onNavigateBack } = props;
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
  const evalRulesContext = useOptionalEvalRulesDataContext();
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const params = useParams<{ ruleID?: string }>();
  const ruleIDFromRoute = params.ruleID;
  const ruleID = propRuleID ?? ruleIDFromRoute;
  const isNew = ruleID == null || ruleID === 'new';

  const [ruleIDInput, setRuleIDInput] = useState('');
  const [selector, setSelector] = useState<RuleSelector>('user_visible_turn');
  const [match, setMatch] = useState<Record<string, string | string[]>>({});
  const [sampleRate, setSampleRate] = useState(0.01);
  const [evaluatorIDs, setEvaluatorIDs] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [availableEvaluators, setAvailableEvaluators] = useState<Evaluator[]>([]);
  const [preview, setPreview] = useState<RulePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestVersion = useRef(0);

  const goBack = useCallback(() => {
    if (onNavigateBack != null) {
      onNavigateBack();
    } else {
      navigate(`${PLUGIN_BASE}/${ROUTES.Evaluation}/rules`);
    }
  }, [navigate, onNavigateBack]);

  useEffect(() => {
    if (isNew) {
      setRuleIDInput('');
      setSelector('user_visible_turn');
      setMatch({});
      setSampleRate(0.01);
      setEvaluatorIDs([]);
      setEnabled(true);
      setLoading(false);
      return;
    }

    requestVersion.current += 1;
    const version = requestVersion.current;
    setLoading(true);
    setErrorMessage('');

    Promise.all([dataSource.getRule(ruleID), dataSource.listEvaluators()])
      .then(([rule, evaluatorsRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setRuleIDInput(rule.rule_id);
        setSelector(rule.selector);
        setMatch(rule.match);
        setSampleRate(rule.sample_rate);
        setEvaluatorIDs(rule.evaluator_ids);
        setEnabled(rule.enabled);
        setAvailableEvaluators(pickLatestVersionPerEvaluator(evaluatorsRes.items));
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load rule');
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource, ruleID, isNew]);

  useEffect(() => {
    if (isNew) {
      void dataSource
        .listEvaluators()
        .then((res) => setAvailableEvaluators(pickLatestVersionPerEvaluator(res.items)))
        .catch((err) => {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluators');
        });
    }
  }, [dataSource, isNew]);

  const previewVersion = useRef(0);
  const matchKey = JSON.stringify(match);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    previewVersion.current += 1;
    const version = previewVersion.current;

    const runPreview = () => {
      setPreviewLoading(true);
      void dataSource
        .previewRule({ rule_id: ruleID ?? ruleIDInput, selector, match, sample_rate: sampleRate })
        .then((res) => {
          if (previewVersion.current === version) {
            setPreview(res);
          }
        })
        .catch(() => {
          if (previewVersion.current === version) {
            setPreview(null);
          }
        })
        .finally(() => {
          if (previewVersion.current === version) {
            setPreviewLoading(false);
          }
        });
    };

    debounceRef.current = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, selector, matchKey, sampleRate, loading]);

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage('');
    try {
      if (isNew) {
        const id = ruleIDInput.trim() || 'unnamed-rule';
        const req: CreateRuleRequest = {
          rule_id: id,
          enabled: enabled,
          selector,
          match,
          sample_rate: sampleRate,
          evaluator_ids: evaluatorIDs,
        };
        await dataSource.createRule(req);
      } else {
        const req: UpdateRuleRequest = {
          enabled,
          selector,
          match,
          sample_rate: sampleRate,
          evaluator_ids: evaluatorIDs,
        };
        await dataSource.updateRule(ruleID!, req);
      }
      evalRulesContext?.refetch();
      goBack();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    goBack();
  };

  const handleDelete = async () => {
    if (!ruleID || isNew) {
      return;
    }
    if (!window.confirm(`Delete rule "${ruleID}"?`)) {
      return;
    }
    setDeleting(true);
    setErrorMessage('');
    try {
      await dataSource.deleteRule(ruleID);
      evalRulesContext?.refetch();
      goBack();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete rule');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddMatchCriteria = useCallback(
    (key: string, value: string) => {
      if (!isNew) {
        return;
      }
      setMatch((prev) => {
        const existing = prev[key];
        const nextSet = new Set(Array.isArray(existing) ? existing : existing ? [existing] : []);
        nextSet.add(value);
        const arr = [...nextSet];
        return { ...prev, [key]: arr.length === 1 ? arr[0] : arr };
      });
    },
    [isNew]
  );

  const validationErrors: string[] = [];
  if (isNew && !ruleIDInput.trim()) {
    validationErrors.push('Rule ID');
  }
  if (isNew && ruleIDInput.trim() && !isValidResourceID(ruleIDInput.trim())) {
    validationErrors.push('Rule ID (invalid characters)');
  }
  if (evaluatorIDs.length === 0) {
    validationErrors.push('Evaluators');
  }
  const canSave = validationErrors.length === 0;

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div>
              <div className={styles.headerTitleRow}>
                <Text element="h3" weight="bold">
                  {isNew ? 'Create Rule' : 'Edit Rule'}
                </Text>
                {isNew && <Badge text="New" color="blue" />}
              </div>
              {isNew && (
                <div className={styles.headerSubtitle}>Configure selectors, match criteria, and evaluators.</div>
              )}
            </div>
          </div>
        </div>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div>
            <div className={styles.headerTitleRow}>
              <Text element="h3" weight="bold">
                {isNew ? 'Create Rule' : 'Edit Rule'}
              </Text>
              {isNew && <Badge text="New" color="blue" />}
            </div>
            {isNew && <div className={styles.headerSubtitle}>Configure selectors, match criteria, and evaluators.</div>}
          </div>
        </div>
        <div className={styles.actions}>
          {!isNew && (
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || saving} icon="trash-alt">
              {deleting ? 'Deleting...' : 'Delete Rule'}
            </Button>
          )}
          <Button variant="secondary" onClick={handleCancel} disabled={saving || deleting}>
            Cancel
          </Button>
          {!canSave ? (
            <Tooltip content={`Missing required: ${validationErrors.join(', ')}`}>
              <span>
                <Button variant="primary" disabled icon="save">
                  Save Rule
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || deleting}
              icon={saving ? undefined : 'save'}
            >
              {saving ? 'Saving...' : isNew ? 'Save Rule' : 'Update Rule'}
            </Button>
          )}
        </div>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.layout}>
        <div className={styles.left}>
          <div className={styles.formCard}>
            <RuleEnableToggle
              ruleID={(ruleID ?? ruleIDInput) || 'new-rule'}
              enabled={enabled}
              onToggle={(_, v) => setEnabled(v)}
            />
            <RuleForm
              key={ruleID ?? 'new'}
              ruleID={ruleIDInput}
              isNew={isNew}
              selector={selector}
              match={match}
              sampleRate={sampleRate}
              evaluatorIDs={evaluatorIDs}
              availableEvaluators={availableEvaluators}
              onSelectorChange={setSelector}
              onMatchChange={setMatch}
              onSampleRateChange={setSampleRate}
              onEvaluatorIDsChange={setEvaluatorIDs}
              onRuleIDChange={setRuleIDInput}
            />
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.rightInner}>
            <DryRunPreview
              preview={preview}
              loading={previewLoading}
              onAddMatchCriteria={isNew ? handleAddMatchCriteria : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
