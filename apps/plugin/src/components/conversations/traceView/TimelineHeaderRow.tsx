// Ported from Grafana's TraceView (Apache 2.0)
// Simplified: single column header with title and collapse controls.

import { css } from '@emotion/css';
import React from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import TimelineCollapser from './TimelineCollapser';

const getStyles = (theme: GrafanaTheme2) => ({
  TimelineHeaderRow: css({
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    height: '38px',
    lineHeight: '38px',
    width: '100%',
    zIndex: 4,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    paddingLeft: theme.spacing(1),
    paddingRight: theme.spacing(1),
  }),
  TimelineHeaderRowTitle: css({
    flex: 1,
    overflow: 'hidden',
    margin: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
});

export type TimelineHeaderRowProps = {
  onCollapseAll: () => void;
  onCollapseOne: () => void;
  onExpandAll: () => void;
  onExpandOne: () => void;
};

export default function TimelineHeaderRow(props: TimelineHeaderRowProps) {
  const { onCollapseAll, onCollapseOne, onExpandAll, onExpandOne } = props;
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.TimelineHeaderRow}>
      <h4 className={styles.TimelineHeaderRowTitle}>Service &amp; Operation</h4>
      <TimelineCollapser
        onCollapseAll={onCollapseAll}
        onCollapseOne={onCollapseOne}
        onExpandAll={onExpandAll}
        onExpandOne={onExpandOne}
      />
    </div>
  );
}
