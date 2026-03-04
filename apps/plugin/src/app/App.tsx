import React, { useEffect, useMemo, useRef } from 'react';
import { css, cx } from '@emotion/css';
import type { AppRootProps, GrafanaTheme2, NavModel } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { Route, Routes, useLocation } from 'react-router-dom';
import { PAGE_TITLES, PLUGIN_BASE, ROUTES } from '../constants';
import { PageRoot } from './PageRoot';

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
const APP_TITLE = 'Sigil';
const GRAFANA_TITLE_SUFFIX = ' - Grafana';

type RouteTitle = { title: string; sectionPath: string; navTitle?: string };

const CONVERSATIONS_CHROME_LIGHT_ROUTE = new RegExp(`^${ROUTES.Conversations}(?:/[^/]+/(view|explore))?$`);

export function isChromeLightRoute(path: string): boolean {
  const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '');

  if (CONVERSATIONS_CHROME_LIGHT_ROUTE.test(normalizedPath)) {
    return true;
  }

  if (normalizedPath === ROUTES.Agents) {
    return true;
  }

  return normalizedPath === ROUTES.Evaluation || normalizedPath.startsWith(`${ROUTES.Evaluation}/`);
}

function resolveRouteTitle(path: string): RouteTitle {
  if (path === '' || path === ROUTES.Root || path === ROUTES.Dashboard) {
    return { title: APP_TITLE, navTitle: '', sectionPath: ROUTES.Root };
  }

  if (path === ROUTES.Landing1) {
    return { title: PAGE_TITLES[ROUTES.Landing1], sectionPath: ROUTES.Landing1 };
  }

  if (path === ROUTES.ConversationsOld) {
    return { title: PAGE_TITLES[ROUTES.ConversationsOld], sectionPath: ROUTES.ConversationsOld };
  }

  if (path === ROUTES.Conversations || path.startsWith(`${ROUTES.Conversations}/`)) {
    return { title: PAGE_TITLES[ROUTES.Conversations], sectionPath: ROUTES.Conversations };
  }

  if (path === ROUTES.Agents || path.startsWith(`${ROUTES.Agents}/`)) {
    return { title: PAGE_TITLES[ROUTES.Agents], sectionPath: ROUTES.Agents };
  }

  if (path === ROUTES.Evaluation || path.startsWith(`${ROUTES.Evaluation}/`)) {
    return { title: PAGE_TITLES[ROUTES.Evaluation], sectionPath: ROUTES.Evaluation };
  }

  return { title: APP_TITLE, sectionPath: ROUTES.Root };
}

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
  }),
  conversationsRouteContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    height: '100%',
    minHeight: 0,
    marginTop: theme.spacing(-2),
    overflow: 'hidden',
    position: 'relative',
  }),
});

export default function App(props: AppRootProps) {
  const { basename, onNavChanged } = props;
  const styles = useStyles2(getStyles);
  const location = useLocation();
  const grafanaTitleSuffix = useRef('');
  const appBaseUrl = useMemo(() => {
    if (location.pathname.startsWith(PLUGIN_BASE)) {
      return PLUGIN_BASE;
    }
    return basename;
  }, [basename, location.pathname]);
  const pluginRelativePath = useMemo(() => {
    if (location.pathname.startsWith(PLUGIN_BASE)) {
      return location.pathname.slice(PLUGIN_BASE.length).replace(/^\/+/, '');
    }
    return location.pathname.replace(/^\/+/, '');
  }, [location.pathname]);
  const currentRoute = useMemo(() => resolveRouteTitle(pluginRelativePath), [pluginRelativePath]);
  const currentTitle = currentRoute.title;

  useEffect(() => {
    const main = {
      text: APP_TITLE,
      url: appBaseUrl,
      hideFromBreadcrumbs: true,
    };
    const node = {
      text: '',
      url: appBaseUrl,
      hideFromBreadcrumbs: true,
      parentItem: main,
    };
    const navModel: NavModel = { main, node };
    onNavChanged(navModel);
  }, [appBaseUrl, onNavChanged]);

  useEffect(() => {
    if (grafanaTitleSuffix.current.length === 0 && document.title.endsWith(GRAFANA_TITLE_SUFFIX)) {
      grafanaTitleSuffix.current = GRAFANA_TITLE_SUFFIX;
    }

    document.title = `${currentTitle} - ${APP_TITLE}${grafanaTitleSuffix.current}`;
  }, [currentTitle]);

  const chromeLightRoute = isChromeLightRoute(pluginRelativePath);
  const isLanding1Route = /\/landing1\/?$/.test(location.pathname);

  return (
    <div className={cx(styles.pageWrapper, chromeLightRoute && styles.pageWrapperNoPadding)}>
      <div className={styles.routesContainer}>
        <Routes>
          <Route
            path={ROUTES.Landing1}
            element={
              <PageRoot>
                <Landing1Page />
              </PageRoot>
            }
          />
          <Route
            path={ROUTES.Dashboard}
            element={
              <PageRoot>
                <DashboardPage />
              </PageRoot>
            }
          />
          <Route
            path={ROUTES.Conversations}
            element={
              <PageRoot fullBleed>
                <div className={styles.conversationsRouteContainer}>
                  <ConversationsBrowserPage />
                </div>
              </PageRoot>
            }
          />
          <Route
            path={ROUTES.ConversationsView}
            element={
              <PageRoot fullBleed>
                <div className={styles.conversationsRouteContainer}>
                  <ConversationPage />
                </div>
              </PageRoot>
            }
          />
          <Route
            path={ROUTES.ConversationsExplore}
            element={
              <PageRoot fullBleed>
                <div className={styles.conversationsRouteContainer}>
                  <ConversationExplorePage />
                </div>
              </PageRoot>
            }
          />
          <Route path={ROUTES.ConversationsDetail} element={<ConversationDetailPage />} />
          <Route path={ROUTES.ConversationsOld} element={<ConversationsPage />} />
          <Route
            path={ROUTES.Agents}
            element={
              <PageRoot fullBleed>
                <AgentsPage />
              </PageRoot>
            }
          />
          <Route path={ROUTES.AgentDetailByName} element={<AgentDetailPage />} />
          <Route path={ROUTES.AgentDetailAnonymous} element={<AgentDetailPage />} />
          <Route
            path={`${ROUTES.Evaluation}/*`}
            element={
              <PageRoot fullBleed>
                <EvaluationPage />
              </PageRoot>
            }
          />
          <Route path="*" element={isLanding1Route ? <Landing1Page /> : <DashboardPage />} />
        </Routes>
      </div>
    </div>
  );
}
