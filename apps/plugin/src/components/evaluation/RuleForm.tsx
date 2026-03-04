import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Field, Input, useStyles2 } from '@grafana/ui';
import type { Evaluator, RuleSelector } from '../../evaluation/types';
import EvaluatorPicker from './EvaluatorPicker';
import MatchCriteriaEditor from './MatchCriteriaEditor';
import SampleRateInput from './SampleRateInput';
import SelectorPicker from './SelectorPicker';

export type RuleFormProps = {
  ruleID: string;
  isNew: boolean;
  selector: RuleSelector;
  match: Record<string, string | string[]>;
  sampleRate: number;
  evaluatorIDs: string[];
  availableEvaluators: Evaluator[];
  onSelectorChange: (v: RuleSelector) => void;
  onMatchChange: (v: Record<string, string | string[]>) => void;
  onSampleRateChange: (v: number) => void;
  onEvaluatorIDsChange: (ids: string[]) => void;
  onRuleIDChange?: (id: string) => void;
  disabled?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  stack: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    '--rule-form-field-width': `calc(50% - ${theme.spacing(0.5)})`,
  }),
  fieldWidth: css({
    width: 'var(--rule-form-field-width)',
  }),
  ruleIdInput: css({
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
});

export default function RuleForm({
  ruleID,
  isNew,
  selector,
  match,
  sampleRate,
  evaluatorIDs,
  availableEvaluators,
  onSelectorChange,
  onMatchChange,
  onSampleRateChange,
  onEvaluatorIDsChange,
  onRuleIDChange,
  disabled,
}: RuleFormProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.stack}>
      <Field label="Rule ID" description="Unique identifier for this rule.">
        <Input
          className={`${styles.fieldWidth} ${styles.ruleIdInput}`}
          value={ruleID}
          onChange={(e) => onRuleIDChange?.(e.currentTarget.value)}
          placeholder="e.g. online.helpfulness.user_visible"
          disabled={!isNew}
        />
      </Field>

      <Field label="Selector" description="Which generation turns to evaluate.">
        <SelectorPicker value={selector} onChange={onSelectorChange} disabled={disabled} />
      </Field>

      <Field label="Match criteria" description="Filter generations by attribute values.">
        <MatchCriteriaEditor value={match} onChange={onMatchChange} disabled={disabled} />
      </Field>

      <SampleRateInput value={sampleRate} onChange={onSampleRateChange} disabled={disabled} />

      <Field label="Evaluators" description="Evaluators to run on matching generations.">
        <EvaluatorPicker
          value={evaluatorIDs}
          evaluators={availableEvaluators}
          onChange={onEvaluatorIDsChange}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}
