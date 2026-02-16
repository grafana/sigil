import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppPluginMeta, type AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { bootstrap } from './plugin/bootstrap';
import type { ConnectionSettingsProps } from './components/config/ConnectionSettings';

type JSONData = {
  sigilApiUrl?: string;
  tenantId?: string;
};

const LazyApp = lazy(() => import('./app/App'));
const LazyConnectionSettings = lazy(() => import('./components/config/ConnectionSettings'));

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="Loading Sigil" />}>
    <LazyApp {...props} />
  </Suspense>
);

const ConnectionSettings = (props: ConnectionSettingsProps) => (
  <Suspense fallback={<LoadingPlaceholder text="Loading settings" />}>
    <LazyConnectionSettings {...props} />
  </Suspense>
);

class SigilAppPlugin extends AppPlugin<JSONData> {
  private initialized = false;

  init(meta: AppPluginMeta<JSONData>) {
    super.init(meta);
    if (this.initialized) {
      return;
    }

    this.addConfigPage({
      title: 'Connection',
      icon: 'cog',
      body: ConnectionSettings,
      id: 'connection',
    });

    this.initialized = true;
  }
}

export const plugin = new SigilAppPlugin().setRootPage(App);

void bootstrap(plugin);
