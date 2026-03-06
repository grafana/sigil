import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvaluationDataSource } from '../evaluation/api';
import { fetchAllCursorPages } from '../evaluation/pagination';
import type { Evaluator, Rule } from '../evaluation/types';

export type EvalRulesData = {
  rules: Rule[];
  evaluators: Evaluator[];
  predefinedCount: number;
  loading: boolean;
  errorMessage: string;
  setErrorMessage: (msg: string) => void;
  handleToggle: (ruleID: string, enabled: boolean) => Promise<void>;
  refetch: () => void;
};

export function useEvalRulesData(dataSource: EvaluationDataSource): EvalRulesData {
  const [rules, setRules] = useState<Rule[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [predefinedCount, setPredefinedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const requestVersion = useRef(0);

  const refetch = useCallback(() => setRefetchTrigger((t) => t + 1), []);

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

    Promise.all([
      fetchAllCursorPages((cursor) => dataSource.listRules(500, cursor)),
      fetchAllCursorPages((cursor) => dataSource.listEvaluators(500, cursor)),
      dataSource.listPredefinedEvaluators(),
    ])
      .then(([rules, evaluators, predefinedRes]) => {
        if (requestVersion.current !== version) {
          return;
        }
        setRules(rules);
        setEvaluators([...evaluators, ...predefinedRes.items]);
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
  }, [dataSource, refetchTrigger]);

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

  return { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage, handleToggle, refetch };
}
