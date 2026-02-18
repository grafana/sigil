import React from 'react';
import { Route, Routes } from 'react-router-dom';
import type { AppRootProps } from '@grafana/data';
import { ROUTES } from '../constants';

const DashboardPage = React.lazy(() => import('../pages/DashboardPage'));
const ConversationsPage = React.lazy(() => import('../pages/ConversationsPage'));
const CompletionsPage = React.lazy(() => import('../pages/CompletionsPage'));
const TracesPage = React.lazy(() => import('../pages/TracesPage'));
const SettingsPage = React.lazy(() => import('../pages/SettingsPage'));

export default function App(_props: AppRootProps) {
  return (
    <Routes>
      <Route path={ROUTES.Dashboard} element={<DashboardPage />} />
      <Route path={ROUTES.Conversations} element={<ConversationsPage />} />
      <Route path={ROUTES.Completions} element={<CompletionsPage />} />
      <Route path={ROUTES.Traces} element={<TracesPage />} />
      <Route path={ROUTES.Settings} element={<SettingsPage />} />
      <Route path="*" element={<DashboardPage />} />
    </Routes>
  );
}
