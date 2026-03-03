import React, { useState } from 'react';
import RuleEnableToggle from '../../components/evaluation/RuleEnableToggle';

function RuleEnableToggleWrapper() {
  const [enabled, setEnabled] = useState(true);
  return (
    <div style={{ maxWidth: 520 }}>
      <RuleEnableToggle ruleID="rule-001" enabled={enabled} onToggle={(_, newVal) => setEnabled(newVal)} />
    </div>
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
