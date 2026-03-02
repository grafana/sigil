import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { css } from '@emotion/css';
import type { AppRootProps, GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { ROUTES } from '../constants';

const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const ConversationsListPage = React.lazy(() => import('../pages/ConversationsListPage'));
const ConversationDetailPage = React.lazy(() => import('../pages/ConversationDetailPage'));
const ConversationsPage = React.lazy(() => import('../pages/ConversationsPage'));
const CompletionsPage = React.lazy(() => import('../pages/CompletionsPage'));
const TracesPage = React.lazy(() => import('../pages/TracesPage'));
const EvaluationPage = React.lazy(() => import('../pages/EvaluationPage'));
const SettingsPage = React.lazy(() => import('../pages/SettingsPage'));

const getStyles = (theme: GrafanaTheme2) => ({
  pageWrapper: css({
    padding: theme.spacing(3),
  }),
});

export default function App(_props: AppRootProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.pageWrapper}>
      <Routes>
        <Route path={ROUTES.Dashboard} element={<DashboardPage />} />
        <Route path={ROUTES.Conversations} element={<ConversationsListPage />} />
        <Route path={ROUTES.ConversationsDetail} element={<ConversationDetailPage />} />
        <Route path={ROUTES.ConversationsOld} element={<ConversationsPage />} />
        <Route path={ROUTES.Completions} element={<CompletionsPage />} />
        <Route path={ROUTES.Traces} element={<TracesPage />} />
        <Route path={`${ROUTES.Evaluation}/*`} element={<EvaluationPage />} />
        <Route path={ROUTES.Settings} element={<SettingsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}
