import React, { createContext, useContext, type ReactNode } from 'react';
import type { EvaluationDataSource } from '../evaluation/api';
import { useEvalRulesData, type EvalRulesData } from '../hooks/useEvalRulesData';

const EvalRulesDataContext = createContext<EvalRulesData | null>(null);

export type EvalRulesDataProviderProps = {
  dataSource: EvaluationDataSource;
  children: ReactNode;
};

export function EvalRulesDataProvider({ dataSource, children }: EvalRulesDataProviderProps) {
  const value = useEvalRulesData(dataSource);
  return <EvalRulesDataContext.Provider value={value}>{children}</EvalRulesDataContext.Provider>;
}

export function useEvalRulesDataContext(): EvalRulesData {
  const ctx = useContext(EvalRulesDataContext);
  if (ctx == null) {
    throw new Error('useEvalRulesDataContext must be used within EvalRulesDataProvider');
  }
  return ctx;
}

export function useOptionalEvalRulesDataContext(): EvalRulesData | null {
  return useContext(EvalRulesDataContext);
}
