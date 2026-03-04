// Ported from Grafana's TraceView (Apache 2.0)

import { css } from '@emotion/css';
import React from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2) => ({
  TimelineCollapser: css({
    alignItems: 'center',
    display: 'flex',
    flex: 'none',
    justifyContent: 'center',
    marginRight: '0.5rem',
  }),
  buttonsContainer: css({
    display: 'flex',
    flexDirection: 'row',
    gap: '0.5rem',
    paddingRight: theme.spacing(1),
  }),
  buttonContainer: css({
    display: 'flex',
    alignItems: 'center',
  }),
});

type CollapserProps = {
  onCollapseAll: () => void;
  onCollapseOne: () => void;
  onExpandOne: () => void;
  onExpandAll: () => void;
};

export default function TimelineCollapser({ onExpandAll, onExpandOne, onCollapseAll, onCollapseOne }: CollapserProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.TimelineCollapser}>
      <div className={styles.buttonsContainer}>
        <div className={styles.buttonContainer}>
          <Button
            onClick={onExpandOne}
            icon="angle-double-right"
            variant="secondary"
            fill="text"
            size="sm"
            tooltip="Expand +1"
          />
        </div>
        <div className={styles.buttonContainer}>
          <Button
            onClick={onCollapseOne}
            icon="angle-right"
            variant="secondary"
            fill="text"
            size="sm"
            tooltip="Collapse +1"
          />
        </div>
        <div className={styles.buttonContainer}>
          <Button
            onClick={onExpandAll}
            icon="angle-double-down"
            variant="secondary"
            fill="text"
            size="sm"
            tooltip="Expand all"
          />
        </div>
        <div className={styles.buttonContainer}>
          <Button
            onClick={onCollapseAll}
            icon="angle-double-up"
            variant="secondary"
            fill="text"
            size="sm"
            tooltip="Collapse all"
          />
        </div>
      </div>
    </div>
  );
}
