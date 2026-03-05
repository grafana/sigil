import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { RadioButtonGroup, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import type { BreakdownDimension, DashboardFilters } from '../../dashboard/types';
import { DashboardConsumptionGrid } from './DashboardConsumptionGrid';
import { DashboardCacheGrid } from './DashboardCacheGrid';

export type DashboardUsageGridProps = {
  dataSource: DashboardDataSource;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  from: number;
  to: number;
  timeRange: TimeRange;
};

type UsageSubView = 'tokens' | 'cache';

const subViewOptions: Array<{ label: string; value: UsageSubView }> = [
  { label: 'Tokens & Cost', value: 'tokens' },
  { label: 'Cache', value: 'cache' },
];

export function DashboardUsageGrid(props: DashboardUsageGridProps) {
  const styles = useStyles2(getStyles);
  const [subView, setSubView] = useState<UsageSubView>('tokens');

  return (
    <div className={styles.wrapper}>
      <div className={styles.subViewBar}>
        <RadioButtonGroup options={subViewOptions} value={subView} onChange={setSubView} size="sm" />
      </div>
      {subView === 'tokens' ? <DashboardConsumptionGrid {...props} /> : <DashboardCacheGrid {...props} />}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    subViewBar: css({
      display: 'flex',
      paddingTop: theme.spacing(0.5),
    }),
  };
}
