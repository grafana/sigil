import React from 'react';
import { css, cx } from '@emotion/css';
import type { AppRootProps, GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ROUTES } from '../constants';

const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const Landing1Page = React.lazy(() => import('../pages/Landing1Page'));
const ConversationsBrowserPage = React.lazy(() => import('../pages/ConversationsBrowserPage'));
const ConversationPage = React.lazy(() => import('../pages/ConversationPage'));
const ConversationDetailPage = React.lazy(() => import('../pages/ConversationDetailPage'));
const ConversationsPage = React.lazy(() => import('../pages/ConversationsPage'));
const EvaluationPage = React.lazy(() => import('../pages/EvaluationPage'));

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
  const isConversationsRoute = new RegExp(`(^|/)${ROUTES.Conversations}(/[^/]+/view)?/?$`).test(location.pathname);
  const isLanding1Route = /\/landing1\/?$/.test(location.pathname);

  return (
    <div className={cx(styles.pageWrapper, isConversationsRoute && styles.pageWrapperNoPadding)}>
      <div className={styles.routesContainer}>
        <Routes>
          <Route path={ROUTES.Landing1} element={<Landing1Page />} />
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
                <ConversationPage />
              </div>
            }
          />
          <Route path={ROUTES.ConversationsDetail} element={<ConversationDetailPage />} />
          <Route path={ROUTES.ConversationsOld} element={<ConversationsPage />} />
          <Route path={`${ROUTES.Evaluation}/*`} element={<EvaluationPage />} />
          <Route path="*" element={isLanding1Route ? <Landing1Page /> : <DashboardPage />} />
        </Routes>
      </div>
    </div>
  );
}
