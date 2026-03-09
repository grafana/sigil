import React, { useState } from 'react';
import HeuristicRuleBuilder from '../../components/evaluation/HeuristicRuleBuilder';
import { createDefaultHeuristicQuery } from '../../evaluation/heuristicConfig';

const meta = {
  title: 'Sigil/Evaluation/HeuristicRuleBuilder',
  component: HeuristicRuleBuilder,
};

export default meta;

export const Default = {
  render: () => {
    const [root, setRoot] = useState(
      createDefaultHeuristicQuery({
        version: 'v2',
        root: {
          kind: 'group',
          operator: 'and',
          rules: [
            { kind: 'rule', type: 'not_empty' },
            {
              kind: 'group',
              operator: 'or',
              rules: [
                { kind: 'rule', type: 'contains', value: 'refund' },
                { kind: 'rule', type: 'contains', value: 'return' },
              ],
            },
          ],
        },
      })
    );

    return <HeuristicRuleBuilder query={root} onChange={setRoot} />;
  },
};
