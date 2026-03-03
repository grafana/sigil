import React from 'react';
import { useLocation } from 'react-router-dom';
import { css } from '@emotion/css';
import { Tab, TabsBar } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../../constants';

const hideScrollbar = css({
  '& > div': {
    overflowX: 'hidden',
  },
});

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;

type EvalTab = 'overview' | 'evaluators' | 'rules' | 'templates';

function getActiveTab(pathname: string): EvalTab {
  if (pathname.includes('/evaluators')) {
    return 'evaluators';
  }
  if (pathname.includes('/rules')) {
    return 'rules';
  }
  if (pathname.includes('/templates')) {
    return 'templates';
  }
  return 'overview';
}

export default function EvalTabBar() {
  const location = useLocation();
  const activeTab = getActiveTab(location.pathname);

  return (
    <div className={hideScrollbar}>
      <TabsBar>
        <Tab label="Overview" active={activeTab === 'overview'} href={EVAL_BASE} />
        <Tab label="Evaluators" active={activeTab === 'evaluators'} href={`${EVAL_BASE}/evaluators`} />
        <Tab label="Rules" active={activeTab === 'rules'} href={`${EVAL_BASE}/rules`} />
        <Tab label="Templates" active={activeTab === 'templates'} href={`${EVAL_BASE}/templates`} />
      </TabsBar>
    </div>
  );
}
