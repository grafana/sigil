import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Field, FieldSet, Input, Stack, useStyles2 } from '@grafana/ui';
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
      <Stack direction="column" gap={2}>
        <FieldSet label="Rule ID">
          <Field label="Rule ID" description="Unique identifier for this rule.">
            <Input
              value={ruleID}
              onChange={(e) => onRuleIDChange?.(e.currentTarget.value)}
              placeholder="e.g. online.helpfulness.user_visible"
              width={40}
              disabled={!isNew}
            />
          </Field>
        </FieldSet>

        <FieldSet label="Selector">
          <SelectorPicker value={selector} onChange={onSelectorChange} disabled={disabled} />
        </FieldSet>

        <FieldSet label="Match criteria">
          <MatchCriteriaEditor value={match} onChange={onMatchChange} disabled={disabled} />
        </FieldSet>

        <FieldSet label="Sample rate">
          <SampleRateInput value={sampleRate} onChange={onSampleRateChange} disabled={disabled} />
        </FieldSet>

        <FieldSet label="Evaluators">
          <EvaluatorPicker
            value={evaluatorIDs}
            evaluators={availableEvaluators}
            onChange={onEvaluatorIDsChange}
            disabled={disabled}
          />
        </FieldSet>
      </Stack>
    </div>
  );
}
