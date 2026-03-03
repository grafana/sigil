import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Field, Icon, Input, Text, useStyles2 } from '@grafana/ui';
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
    gap: theme.spacing(2),
    '--rule-form-field-width': `calc(50% - ${theme.spacing(0.5)})`,
  }),
  fieldWidth: css({
    width: 'var(--rule-form-field-width)',
  }),
  sectionCard: css({
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
  }),
  section: css({
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
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
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <Icon name="file-alt" size="md" />
          <Text weight="medium">Rule ID</Text>
        </div>
        <Field label="Rule ID" description="Unique identifier for this rule.">
          <Input
            className={styles.fieldWidth}
            value={ruleID}
            onChange={(e) => onRuleIDChange?.(e.currentTarget.value)}
            placeholder="e.g. online.helpfulness.user_visible"
            disabled={!isNew}
          />
        </Field>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="filter" size="md" />
          <Text weight="medium">Selector</Text>
        </div>
        <SelectorPicker value={selector} onChange={onSelectorChange} disabled={disabled} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="search" size="md" />
          <Text weight="medium">Match criteria</Text>
        </div>
        <MatchCriteriaEditor value={match} onChange={onMatchChange} disabled={disabled} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="percentage" size="md" />
          <Text weight="medium">Sample rate</Text>
        </div>
        <SampleRateInput value={sampleRate} onChange={onSampleRateChange} disabled={disabled} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="check-circle" size="md" />
          <Text weight="medium">Evaluators</Text>
        </div>
        <EvaluatorPicker
          value={evaluatorIDs}
          evaluators={availableEvaluators}
          onChange={onEvaluatorIDsChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
