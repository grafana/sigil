import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { TopStat, type TopStatProps } from '../TopStat';

export type DashboardStatsBarProps = {
  stats: TopStatProps[];
};

export function DashboardStatsBar({ stats }: DashboardStatsBarProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.statsRow}>
      {stats.map((stat) => (
        <TopStat
          key={stat.label}
          label={stat.label}
          value={stat.value}
          unit={stat.unit}
          loading={stat.loading}
          prevValue={stat.prevValue}
          prevLoading={stat.prevLoading}
          invertChange={stat.invertChange}
          comparisonLabel={stat.comparisonLabel}
        />
      ))}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    statsRow: css({
      display: 'flex',
      flexWrap: 'nowrap',
      gap: theme.spacing(4),
      padding: theme.spacing(1.5, 2, 0),
      width: '100%',
    }),
  };
}
