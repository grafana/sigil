import React from 'react';
import { css } from '@emotion/css';
import type { AppRootProps, GrafanaTheme2 } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { Route, Routes } from 'react-router-dom';
import { ROUTES } from '../constants';

const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const Landing1Page = React.lazy(() => import('../pages/Landing1Page'));
const ConversationsBrowserPage = React.lazy(() => import('../pages/ConversationsBrowserPage'));
const ConversationPage = React.lazy(() => import('../pages/ConversationPage'));
const ConversationExplorePage = React.lazy(() => import('../pages/ConversationExplorePage'));
const ConversationDetailPage = React.lazy(() => import('../pages/ConversationDetailPage'));
const ConversationsPage = React.lazy(() => import('../pages/ConversationsPage'));
const AgentsPage = React.lazy(() => import('../pages/AgentsPage'));
const AgentDetailPage = React.lazy(() => import('../pages/AgentDetailPage'));
const EvaluationPage = React.lazy(() => import('../pages/EvaluationPage'));

const getStyles = (theme: GrafanaTheme2) => ({
  conversationsRouteContainer: css({
    position: 'relative',
    height: '100%',
    overflow: 'hidden',
  }),
});

export default function App(_props: AppRootProps) {
  const styles = useStyles2(getStyles);

  return (
    // hide the title
    <PluginPage renderTitle={() => <></>} background="canvas">
      <Routes>
        <Route path={ROUTES.Root} element={<Landing1Page />} />
        <Route path={ROUTES.Analytics} element={<DashboardPage />} />
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
        <Route
          path={ROUTES.ConversationsExplore}
          element={
            <div className={styles.conversationsRouteContainer}>
              <ConversationExplorePage />
            </div>
          }
        />
        <Route path={ROUTES.ConversationsDetail} element={<ConversationDetailPage />} />
        <Route path={ROUTES.ConversationsOld} element={<ConversationsPage />} />
        <Route path={ROUTES.Agents} element={<AgentsPage />} />
        <Route path={ROUTES.AgentDetailByName} element={<AgentDetailPage />} />
        <Route path={ROUTES.AgentDetailAnonymous} element={<AgentDetailPage />} />
        <Route path={`${ROUTES.Evaluation}/*`} element={<EvaluationPage />} />
        <Route path="*" element={<Landing1Page />} />
      </Routes>
    </PluginPage>
  );
}
