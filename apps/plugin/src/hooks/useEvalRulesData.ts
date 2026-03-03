import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvaluationDataSource } from '../evaluation/api';
import type { Evaluator, Rule } from '../evaluation/types';

export type EvalRulesData = {
  rules: Rule[];
  evaluators: Evaluator[];
  predefinedCount: number;
  loading: boolean;
  errorMessage: string;
  setErrorMessage: (msg: string) => void;
  handleToggle: (ruleID: string, enabled: boolean) => Promise<void>;
  handleDelete: (ruleID: string) => Promise<void>;
};

export function useEvalRulesData(dataSource: EvaluationDataSource): EvalRulesData {
  const [rules, setRules] = useState<Rule[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [predefinedCount, setPredefinedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    requestVersion.current += 1;
    const version = requestVersion.current;

    queueMicrotask(() => {
      if (requestVersion.current !== version) {
        return;
      }
      setLoading(true);
      setErrorMessage('');
    });

    Promise.all([dataSource.listRules(), dataSource.listEvaluators(), dataSource.listPredefinedEvaluators()])
      .then(([rulesRes, evaluatorsRes, predefinedRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setRules(rulesRes.items);
        setEvaluators([...evaluatorsRes.items, ...predefinedRes.items]);
        setPredefinedCount(predefinedRes.items.length);
      })
      .catch((err) => {
        if (requestVersion.current !== version) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load evaluation data');
        setRules([]);
        setEvaluators([]);
      })
      .finally(() => {
        if (requestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [dataSource]);

  const handleToggle = useCallback(
    async (ruleID: string, enabled: boolean) => {
      try {
        const updated = await dataSource.updateRule(ruleID, { enabled });
        setRules((prev) => prev.map((r) => (r.rule_id === ruleID ? updated : r)));
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update rule');
      }
    },
    [dataSource]
  );

  const handleDelete = useCallback(
    async (ruleID: string) => {
      try {
        await dataSource.deleteRule(ruleID);
        setRules((prev) => prev.filter((r) => r.rule_id !== ruleID));
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to delete rule');
      }
    },
    [dataSource]
  );

  return { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage, handleToggle, handleDelete };
}
