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

type EvalTab = 'overview' | 'evaluators' | 'rules' | 'results';

function getActiveTab(pathname: string): EvalTab {
  if (pathname.includes('/evaluators') || pathname.includes('/templates')) {
    return 'evaluators';
  }
  if (pathname.includes('/rules')) {
    return 'rules';
  }
  if (pathname.includes('/results')) {
    return 'results';
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
        <Tab label="Results" active={activeTab === 'results'} href={`${EVAL_BASE}/results`} />
        <Tab label="Evaluators" active={activeTab === 'evaluators'} href={`${EVAL_BASE}/evaluators`} />
        <Tab label="Rules" active={activeTab === 'rules'} href={`${EVAL_BASE}/rules`} />
      </TabsBar>
    </div>
  );
}
