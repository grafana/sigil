import React from 'react';
import { Field, Switch } from '@grafana/ui';

export type RuleEnableToggleProps = {
  ruleID: string;
  enabled: boolean;
  onToggle: (ruleID: string, enabled: boolean) => void;
};

export default function RuleEnableToggle({ ruleID, enabled, onToggle }: RuleEnableToggleProps) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onToggle(ruleID, event.target.checked);
  };

  return (
    <Field label="Enable rule" description="When enabled, the rule is applied to matching generations.">
      <Switch value={enabled} onChange={handleChange} aria-label={`Toggle rule ${ruleID}`} />
    </Field>
  );
}
