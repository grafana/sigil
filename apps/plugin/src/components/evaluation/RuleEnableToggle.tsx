import React from 'react';
import { Switch } from '@grafana/ui';

export type RuleEnableToggleProps = {
  ruleID: string;
  enabled: boolean;
  onToggle: (ruleID: string, enabled: boolean) => void;
};

export default function RuleEnableToggle({ ruleID, enabled, onToggle }: RuleEnableToggleProps) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onToggle(ruleID, event.target.checked);
  };

  return <Switch value={enabled} onChange={handleChange} aria-label={`Toggle rule ${ruleID}`} />;
}
