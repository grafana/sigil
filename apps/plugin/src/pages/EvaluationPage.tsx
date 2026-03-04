import React, { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { LoadingPlaceholder, Stack, useStyles2 } from '@grafana/ui';
import EvalPipelineBanner from '../components/evaluation/EvalPipelineBanner';
import EvalTabBar from '../components/evaluation/EvalTabBar';
import { EvalRulesDataProvider } from '../contexts/EvalRulesDataContext';
import { defaultEvaluationDataSource } from '../evaluation/api';

const EvaluationOverviewPage = React.lazy(() => import('./EvaluationOverviewPage'));
const EvaluatorsPage = React.lazy(() => import('./EvaluatorsPage'));
const CreateEvaluatorPage = React.lazy(() => import('./CreateEvaluatorPage'));
const EditEvaluatorPage = React.lazy(() => import('./EditEvaluatorPage'));
const CreateTemplatePage = React.lazy(() => import('./CreateTemplatePage'));
const ForkTemplatePage = React.lazy(() => import('./ForkTemplatePage'));
const RulesPage = React.lazy(() => import('./RulesPage'));
const RuleDetailPage = React.lazy(() => import('./RuleDetailPage'));
const TemplateDetailPage = React.lazy(() => import('./TemplateDetailPage'));

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    marginTop: theme.spacing(-2),
  }),
});

export default function EvaluationPage() {
  const styles = useStyles2(getStyles);

  return (
    <EvalRulesDataProvider dataSource={defaultEvaluationDataSource}>
      <div className={styles.page}>
        <Stack direction="column" gap={2}>
          <EvalPipelineBanner />
          <EvalTabBar />
          <Suspense fallback={<LoadingPlaceholder text="Loading..." />}>
            <Routes>
              <Route index element={<EvaluationOverviewPage />} />
              <Route path="evaluators" element={<EvaluatorsPage />} />
              <Route path="evaluators/new" element={<CreateEvaluatorPage />} />
              <Route path="evaluators/:evaluatorID/edit" element={<EditEvaluatorPage />} />
              <Route path="templates/new" element={<CreateTemplatePage />} />
              <Route path="templates/:templateID/fork" element={<ForkTemplatePage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="rules/new" element={<RuleDetailPage />} />
              <Route path="rules/:ruleID" element={<RuleDetailPage />} />
              <Route path="templates/:templateID" element={<TemplateDetailPage />} />
            </Routes>
          </Suspense>
        </Stack>
      </div>
    </EvalRulesDataProvider>
  );
}
