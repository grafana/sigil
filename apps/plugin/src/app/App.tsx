import React from 'react';
import { css } from '@emotion/css';
import type { AppRootProps, GrafanaTheme2, NavModelItem } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { Route, Routes, useLocation } from 'react-router-dom';
import { PLUGIN_BASE, ROUTES } from '../constants';

const LandingPage = React.lazy(() => import('../pages/LandingPage'));
const PlaygroundSparklesPage = React.lazy(() => import('../pages/PlaygroundSparklesPage'));
const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const ToolsPage = React.lazy(() => import('../pages/ToolsPage'));
const ToolAnalyticsPage = React.lazy(() => import('../pages/ToolAnalyticsPage'));
const TutorialPage = React.lazy(() => import('../pages/TutorialPage'));
const ConversationsBrowserPage = React.lazy(() => import('../pages/ConversationsBrowserPage'));
const ConversationExplorePage = React.lazy(() => import('../pages/ConversationExplorePage'));
const SavedConversationsPage = React.lazy(() => import('../pages/SavedConversationsPage'));
const AgentsPage = React.lazy(() => import('../pages/AgentsPage'));
const AgentDetailPage = React.lazy(() => import('../pages/AgentDetailPage'));
const EvaluationPage = React.lazy(() => import('../pages/EvaluationPage'));

const getStyles = (theme: GrafanaTheme2) => ({
  conversationsRouteContainer: css({
    position: 'relative',
    height: '100%',
    overflow: 'hidden',
  }),
  hidePluginHeader: css({
    '& > [class*="page-header"]': {
      display: 'none',
    },
  }),
  fullBleedPageInner: css({
    padding: '0 !important',
  }),
});

function useAgentDetailPageNav(): NavModelItem | undefined {
  const location = useLocation();
  const agentDetailMatch = location.pathname.match(new RegExp(`${PLUGIN_BASE}/${ROUTES.Agents}/name/([^/]+)`));
  const matchedName = agentDetailMatch ? decodeURIComponent(agentDetailMatch[1]) : undefined;
  const isAnonymous = location.pathname.endsWith(`/${ROUTES.Agents}/anonymous`);

  return React.useMemo(() => {
    if (!matchedName && !isAnonymous) {
      return undefined;
    }
    return {
      text: isAnonymous ? 'Unnamed agent bucket' : matchedName!,
      parentItem: {
        text: 'Agents',
        url: `${PLUGIN_BASE}/${ROUTES.Agents}`,
      },
    };
  }, [matchedName, isAnonymous]);
}

function useToolAnalyticsPageNav(): NavModelItem | undefined {
  const location = useLocation();
  const toolMatch = location.pathname.match(new RegExp(`${PLUGIN_BASE}/${ROUTES.AnalyticsTools}/([^/]+)`));
  const matchedToolName = toolMatch ? decodeURIComponent(toolMatch[1]) : undefined;

  return React.useMemo(() => {
    if (!matchedToolName) {
      return undefined;
    }

    return {
      text: matchedToolName,
      parentItem: {
        text: 'Tools',
        url: `${PLUGIN_BASE}/${ROUTES.AnalyticsTools}`,
      },
    };
  }, [matchedToolName]);
}

export default function App(props: AppRootProps) {
  const styles = useStyles2(getStyles);
  const location = useLocation();
  const agentDetailPageNav = useAgentDetailPageNav();
  const toolAnalyticsPageNav = useToolAnalyticsPageNav();
  const pageNav = React.useMemo<NavModelItem>(() => {
    if (agentDetailPageNav) {
      return agentDetailPageNav;
    }
    if (toolAnalyticsPageNav) {
      return toolAnalyticsPageNav;
    }
    return {
      text: props.meta.name,
      subTitle: undefined,
      img: undefined,
      icon: undefined,
      hideFromBreadcrumbs: true,
    };
  }, [props.meta.name, agentDetailPageNav, toolAnalyticsPageNav]);
  const shouldHidePluginHeader = location.pathname.includes(`/${ROUTES.Conversations}`);
  const shouldUseFullBleedPageInner =
    location.pathname.includes(`/${ROUTES.PlaygroundSparkles}`) ||
    location.pathname.includes(`/${ROUTES.Conversations}`);

  React.useEffect(() => {
    const pageInner = document.querySelector('[class*="page-inner"]');
    if (!(pageInner instanceof HTMLElement)) {
      return;
    }
    if (shouldHidePluginHeader) {
      pageInner.classList.add(styles.hidePluginHeader);
    } else {
      pageInner.classList.remove(styles.hidePluginHeader);
    }
    if (shouldUseFullBleedPageInner) {
      pageInner.classList.add(styles.fullBleedPageInner);
    } else {
      pageInner.classList.remove(styles.fullBleedPageInner);
    }
    return () => {
      pageInner.classList.remove(styles.hidePluginHeader);
      pageInner.classList.remove(styles.fullBleedPageInner);
    };
  }, [shouldHidePluginHeader, shouldUseFullBleedPageInner, styles.hidePluginHeader, styles.fullBleedPageInner]);

  return (
    <PluginPage renderTitle={() => <></>} background="canvas" pageNav={pageNav}>
      <Routes>
        <Route path={ROUTES.Root} element={<LandingPage />} />
        <Route
          path={ROUTES.PlaygroundSparkles}
          element={
            <div className={styles.conversationsRouteContainer}>
              <PlaygroundSparklesPage />
            </div>
          }
        />
        <Route path={ROUTES.Analytics} element={<DashboardPage />} />
        <Route path={ROUTES.AnalyticsTools} element={<ToolsPage />} />
        <Route path={ROUTES.AnalyticsTool} element={<ToolAnalyticsPage />} />
        <Route path={`${ROUTES.Tutorial}/*`} element={<TutorialPage />} />
        <Route
          path={ROUTES.Conversations}
          element={
            <div className={styles.conversationsRouteContainer}>
              <ConversationsBrowserPage />
            </div>
          }
        />
        <Route
          path={ROUTES.ConversationsSaved}
          element={
            <div className={styles.conversationsRouteContainer}>
              <SavedConversationsPage />
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
        <Route path={ROUTES.Agents} element={<AgentsPage />} />
        <Route path={ROUTES.AgentDetailByName} element={<AgentDetailPage />} />
        <Route path={ROUTES.AgentDetailAnonymous} element={<AgentDetailPage />} />
        <Route path={`${ROUTES.Evaluation}/*`} element={<EvaluationPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </PluginPage>
  );
}
