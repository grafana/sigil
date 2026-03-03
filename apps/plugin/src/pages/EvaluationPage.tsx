import React, { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingPlaceholder, Stack, Text } from '@grafana/ui';
import EvalTabBar from '../components/evaluation/EvalTabBar';

const EvaluationOverviewPage = React.lazy(() => import('./EvaluationOverviewPage'));
const EvaluatorsPage = React.lazy(() => import('./EvaluatorsPage'));
const RulesPage = React.lazy(() => import('./RulesPage'));
const RuleDetailPage = React.lazy(() => import('./RuleDetailPage'));
const TemplatesPage = React.lazy(() => import('./TemplatesPage'));
const TemplateDetailPage = React.lazy(() => import('./TemplateDetailPage'));

export default function EvaluationPage() {
  return (
    <Stack direction="column" gap={2}>
      <Text element="h2">Evaluation</Text>
      <EvalTabBar />
      <Suspense fallback={<LoadingPlaceholder text="Loading..." />}>
        <Routes>
          <Route index element={<EvaluationOverviewPage />} />
          <Route path="evaluators" element={<EvaluatorsPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="rules/new" element={<RuleDetailPage />} />
          <Route path="rules/:ruleID" element={<RuleDetailPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="templates/:templateID" element={<TemplateDetailPage />} />
        </Routes>
      </Suspense>
    </Stack>
  );
}
