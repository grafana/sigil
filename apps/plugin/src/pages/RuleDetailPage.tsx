import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
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
    gap: theme.spacing(2),
  }),
  layout: css({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(2),
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  left: css({
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  right: css({
    overflow: 'auto',
    minHeight: 0,
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

export default function RuleDetailPage(props: RuleDetailPageProps) {
  const { ruleID: propRuleID, onNavigateBack } = props;
  const dataSource = props.dataSource ?? defaultEvaluationDataSource;
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
        setAvailableEvaluators(evaluatorsRes.items);
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
        .then((res) => setAvailableEvaluators(res.items))
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
        const req: UpdateRuleRequest = { enabled };
        await dataSource.updateRule(ruleID!, req);
      }
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

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <Text element="h2">{isNew ? 'Create Rule' : 'Edit Rule'}</Text>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.actions} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text element="h2">{isNew ? 'Create Rule' : 'Edit Rule'}</Text>
        <Stack direction="row" gap={1}>
          <Button variant="secondary" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving} icon={saving ? undefined : 'save'}>
            {saving ? 'Saving...' : isNew ? 'Save' : 'Update Enabled Status'}
          </Button>
        </Stack>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.layout}>
        <div className={styles.left}>
          <RuleEnableToggle
            ruleID={(ruleID ?? ruleIDInput) || 'new-rule'}
            enabled={enabled}
            onToggle={(_, v) => setEnabled(v)}
          />
          <RuleForm
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
            disabled={!isNew}
          />
        </div>
        <div className={styles.right}>
          <DryRunPreview preview={preview} loading={previewLoading} />
        </div>
      </div>
    </div>
  );
}
