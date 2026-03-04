import React, { Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { LoadingPlaceholder, Stack, Text } from '@grafana/ui';
import EvalPipelineBanner from '../components/evaluation/EvalPipelineBanner';
import EvalTabBar from '../components/evaluation/EvalTabBar';
import { defaultEvaluationDataSource } from '../evaluation/api';
import { useEvalRulesData } from '../hooks/useEvalRulesData';

const EvaluationOverviewPage = React.lazy(() => import('./EvaluationOverviewPage'));
const EvaluatorsPage = React.lazy(() => import('./EvaluatorsPage'));
const CreateEvaluatorPage = React.lazy(() => import('./CreateEvaluatorPage'));
const CreateTemplatePage = React.lazy(() => import('./CreateTemplatePage'));
const ForkTemplatePage = React.lazy(() => import('./ForkTemplatePage'));
const RulesPage = React.lazy(() => import('./RulesPage'));
const RuleDetailPage = React.lazy(() => import('./RuleDetailPage'));
const TemplateDetailPage = React.lazy(() => import('./TemplateDetailPage'));

function isOverviewTab(pathname: string): boolean {
  return !pathname.includes('/evaluators') && !pathname.includes('/templates') && !pathname.includes('/rules');
}

export default function EvaluationPage() {
  const location = useLocation();
  const { rules, loading } = useEvalRulesData(defaultEvaluationDataSource);
  // Hide banner on overview when no rules (onboarding); show everywhere else
  const showBanner = !isOverviewTab(location.pathname) || (!loading && rules.length > 0);

  return (
    <Stack direction="column" gap={2}>
      <Text element="h2">Evaluation</Text>
      {showBanner && <EvalPipelineBanner />}
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
