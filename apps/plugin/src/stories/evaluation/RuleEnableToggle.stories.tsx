import React, { useState } from 'react';
import RuleEnableToggle from '../../components/evaluation/RuleEnableToggle';
import { Stack, Text } from '@grafana/ui';

function RuleEnableToggleWrapper() {
  const [enabled, setEnabled] = useState(true);
  return (
    <Stack direction="row" gap={2} alignItems="center">
      <RuleEnableToggle ruleID="rule-001" enabled={enabled} onToggle={(_, newVal) => setEnabled(newVal)} />
      <Text variant="bodySmall">Rule rule-001 is {enabled ? 'enabled' : 'disabled'}</Text>
    </Stack>
  );
}

const meta = {
  title: 'Sigil/Evaluation/RuleEnableToggle',
  component: RuleEnableToggle,
};

export default meta;

export const Default = {
  render: () => <RuleEnableToggleWrapper />,
};

export const Enabled = {
  args: {
    ruleID: 'rule-001',
    enabled: true,
    onToggle: () => {},
  },
};

export const Disabled = {
  args: {
    ruleID: 'rule-001',
    enabled: false,
    onToggle: () => {},
  },
};
