import React, { useState } from 'react';
import RuleForm from '../../components/evaluation/RuleForm';
import type { Evaluator, RuleSelector } from '../../evaluation/types';

const mockEvaluators: Evaluator[] = [
  {
    evaluator_id: 'prod.helpfulness.v1',
    version: '2026-02-17',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'helpfulness', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
  {
    evaluator_id: 'prod.not_empty',
    version: '2026-02-17',
    kind: 'heuristic',
    config: {},
    output_keys: [{ key: 'not_empty', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
  {
    evaluator_id: 'sigil.helpfulness',
    version: '1.0',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'score', type: 'number' }],
    is_predefined: true,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
];

const meta = {
  title: 'Sigil/Evaluation/RuleForm',
  component: RuleForm,
};

export default meta;

function RuleFormInteractive() {
  const [ruleID, setRuleID] = useState('online.helpfulness.user_visible');
  const [isNew] = useState(true);
  const [selector, setSelector] = useState<RuleSelector>('user_visible_turn');
  const [match, setMatch] = useState<Record<string, string | string[]>>({
    agent_name: ['assistant-*'],
    mode: ['SYNC'],
  });
  const [sampleRate, setSampleRate] = useState(0.1);
  const [evaluatorIDs, setEvaluatorIDs] = useState<string[]>(['prod.helpfulness.v1', 'prod.not_empty']);

  return (
    <RuleForm
      ruleID={ruleID}
      isNew={isNew}
      selector={selector}
      match={match}
      sampleRate={sampleRate}
      evaluatorIDs={evaluatorIDs}
      availableEvaluators={mockEvaluators}
      onSelectorChange={setSelector}
      onMatchChange={setMatch}
      onSampleRateChange={setSampleRate}
      onEvaluatorIDsChange={setEvaluatorIDs}
      onRuleIDChange={setRuleID}
    />
  );
}

export const CreateMode = {
  render: () => <RuleFormInteractive />,
};

export const EditMode = {
  render: () => {
    const [ruleID] = useState('online.helpfulness.user_visible');
    const [selector, setSelector] = useState<RuleSelector>('user_visible_turn');
    const [match, setMatch] = useState<Record<string, string | string[]>>({
      agent_name: ['assistant-*'],
      mode: ['SYNC'],
    });
    const [sampleRate, setSampleRate] = useState(0.1);
    const [evaluatorIDs, setEvaluatorIDs] = useState<string[]>(['prod.helpfulness.v1', 'prod.not_empty']);

    return (
      <RuleForm
        ruleID={ruleID}
        isNew={false}
        selector={selector}
        match={match}
        sampleRate={sampleRate}
        evaluatorIDs={evaluatorIDs}
        availableEvaluators={mockEvaluators}
        onSelectorChange={setSelector}
        onMatchChange={setMatch}
        onSampleRateChange={setSampleRate}
        onEvaluatorIDsChange={setEvaluatorIDs}
      />
    );
  },
};
