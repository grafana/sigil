import React, { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingPlaceholder, Stack, Text } from '@grafana/ui';
import EvalTabBar from '../components/evaluation/EvalTabBar';

const EvaluationOverviewPage = React.lazy(() => import('./EvaluationOverviewPage'));
const EvaluatorsPage = React.lazy(() => import('./EvaluatorsPage'));
const CreateEvaluatorPage = React.lazy(() => import('./CreateEvaluatorPage'));
const CreateTemplatePage = React.lazy(() => import('./CreateTemplatePage'));
const ForkTemplatePage = React.lazy(() => import('./ForkTemplatePage'));
const RulesPage = React.lazy(() => import('./RulesPage'));
const RuleDetailPage = React.lazy(() => import('./RuleDetailPage'));
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
          <Route path="evaluators/new" element={<CreateEvaluatorPage />} />
          <Route path="templates/new" element={<CreateTemplatePage />} />
          <Route path="templates/:templateID/fork" element={<ForkTemplatePage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="rules/new" element={<RuleDetailPage />} />
          <Route path="rules/:ruleID" element={<RuleDetailPage />} />
          <Route path="templates/:templateID" element={<TemplateDetailPage />} />
        </Routes>
      </Suspense>
    </Stack>
  );
}
