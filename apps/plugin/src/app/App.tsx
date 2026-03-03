import React from 'react';
import { css, cx } from '@emotion/css';
import type { AppRootProps, GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ROUTES } from '../constants';

const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const ConversationsBrowserPage = React.lazy(() => import('../pages/ConversationsBrowserPage'));
const ConversationDetailPage = React.lazy(() => import('../pages/ConversationDetailPage'));
const ConversationsPage = React.lazy(() => import('../pages/ConversationsPage'));
const CompletionsPage = React.lazy(() => import('../pages/CompletionsPage'));
const TracesPage = React.lazy(() => import('../pages/TracesPage'));
const EvaluationPage = React.lazy(() => import('../pages/EvaluationPage'));
const SettingsPage = React.lazy(() => import('../pages/SettingsPage'));

const getStyles = (theme: GrafanaTheme2) => ({
  pageWrapper: css({
    padding: theme.spacing(3),
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    height: '100%',
    minHeight: 0,
  }),
  routesContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
  }),
  pageWrapperNoPadding: css({
    padding: 0,
    overflow: 'hidden',
  }),
  conversationsRouteContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  }),
});

export default function App(_props: AppRootProps) {
  const styles = useStyles2(getStyles);
  const location = useLocation();
  const isConversationsBrowserRoute = new RegExp(`(^|/)${ROUTES.Conversations}(/|$)`).test(location.pathname);

  return (
    <div className={cx(styles.pageWrapper, isConversationsBrowserRoute && styles.pageWrapperNoPadding)}>
      <div className={styles.routesContainer}>
        <Routes>
          <Route path={ROUTES.Dashboard} element={<DashboardPage />} />
          <Route
            path={ROUTES.Conversations}
            element={
              <div className={styles.conversationsRouteContainer}>
                <ConversationsBrowserPage />
              </div>
            }
          />
          <Route
            path={ROUTES.ConversationsView}
            element={
              <div className={styles.conversationsRouteContainer}>
                <ConversationsBrowserPage />
              </div>
            }
          />
          <Route path={ROUTES.ConversationsDetail} element={<ConversationDetailPage />} />
          <Route path={ROUTES.ConversationsOld} element={<ConversationsPage />} />
          <Route path={ROUTES.Completions} element={<CompletionsPage />} />
          <Route path={ROUTES.Traces} element={<TracesPage />} />
          <Route path={`${ROUTES.Evaluation}/*`} element={<EvaluationPage />} />
          <Route path={ROUTES.Settings} element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </div>
    </div>
  );
}
