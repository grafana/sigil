import React, { useState } from 'react';
import PipelineCard from '../../components/evaluation/PipelineCard';
import type { Evaluator, Rule } from '../../evaluation/types';

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
];

const mockRule: Rule = {
  rule_id: 'online.helpfulness.user_visible',
  enabled: true,
  selector: 'user_visible_turn',
  match: { agent_name: ['assistant-*'], mode: ['SYNC'] },
  sample_rate: 0.1,
  evaluator_ids: ['prod.helpfulness.v1', 'prod.not_empty'],
  created_at: '2026-02-18T00:00:00Z',
  updated_at: '2026-02-18T00:00:00Z',
};

const meta = {
  title: 'Sigil/Evaluation/PipelineCard',
  component: PipelineCard,
};

export default meta;

export const Default = {
  args: {
    rule: mockRule,
    evaluators: mockEvaluators,
    onToggle: () => {},
    onClick: () => {},
  },
};

export const Disabled = {
  args: {
    rule: { ...mockRule, enabled: false },
    evaluators: mockEvaluators,
    onToggle: () => {},
    onClick: () => {},
  },
};

export const NoMatch = {
  args: {
    rule: { ...mockRule, match: {} },
    evaluators: mockEvaluators,
    onToggle: () => {},
    onClick: () => {},
  },
};

const manyEvaluators: Evaluator[] = [
  ...mockEvaluators,
  {
    evaluator_id: 'prod.safety.v1',
    version: '2026-02-17',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'safety', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
  {
    evaluator_id: 'prod.relevance.v1',
    version: '2026-02-17',
    kind: 'heuristic',
    config: {},
    output_keys: [{ key: 'relevance', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
];

export const ManyEvaluators = {
  args: {
    rule: {
      ...mockRule,
      evaluator_ids: ['prod.helpfulness.v1', 'prod.not_empty', 'prod.safety.v1', 'prod.relevance.v1'],
    },
    evaluators: manyEvaluators,
    onToggle: () => {},
    onClick: () => {},
  },
};

export const LongMatchCriteria = {
  args: {
    rule: {
      ...mockRule,
      rule_id: 'long-match-test',
      match: {
        agent_name: ['devex-go-openai-planner'],
        'model.name': ['gpt-5'],
        'model.provider': ['openai'],
      },
    },
    evaluators: mockEvaluators,
    onToggle: () => {},
    onClick: () => {},
  },
};

export const ShortContent = {
  args: {
    rule: {
      ...mockRule,
      rule_id: 'minimal',
      match: {},
      evaluator_ids: ['fff'],
    },
    evaluators: [{ ...mockEvaluators[0], evaluator_id: 'fff' }],
    onToggle: () => {},
    onClick: () => {},
  },
};

export const MultipleRulesStacked = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PipelineCard
        rule={{
          ...mockRule,
          rule_id: 'online.helpfulnes',
          match: {
            agent_name: ['devex-go-openai-planner'],
            'model.name': ['gpt-5'],
            'model.provider': ['openai'],
          },
        }}
        evaluators={mockEvaluators}
        onToggle={() => {}}
        onClick={() => {}}
      />
      <PipelineCard
        rule={{
          ...mockRule,
          rule_id: 'dcddsc',
          match: {},
        }}
        evaluators={mockEvaluators}
        onToggle={() => {}}
        onClick={() => {}}
      />
    </div>
  ),
};

export const Interactive = {
  render: () => {
    const [rule, setRule] = useState(mockRule);
    return (
      <PipelineCard
        rule={rule}
        evaluators={mockEvaluators}
        onToggle={(_, enabled) => {
          setRule((r) => ({ ...r, enabled }));
        }}
        onClick={() => {}}
      />
    );
  },
};
