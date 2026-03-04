// Ported from Grafana's TraceView (Apache 2.0)
// Simplified: no log markers, critical path, or rpc bar.

import { css } from '@emotion/css';
import React, { useState } from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    overflow: 'hidden',
    zIndex: 0,
  }),
  bar: css({
    borderRadius: theme.shape.radius.default,
    minWidth: '2px',
    position: 'absolute',
    height: '40%',
    top: '30%',
  }),
  label: css({
    color: theme.colors.text.secondary,
    fontSize: '12px',
    fontFamily: theme.typography.fontFamilyMonospace,
    lineHeight: '1em',
    whiteSpace: 'nowrap',
    padding: '0 0.5em',
    position: 'absolute',
  }),
  labelRight: css({
    left: '100%',
  }),
  labelLeft: css({
    right: '100%',
  }),
});

function toPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export type SpanBarProps = {
  color: string;
  onClick?: (evt: React.MouseEvent<HTMLDivElement>) => void;
  viewEnd: number;
  viewStart: number;
  shortLabel: string;
  longLabel: string;
  className?: string;
  labelClassName?: string;
};

function SpanBar({
  viewEnd,
  viewStart,
  color,
  shortLabel,
  longLabel,
  onClick,
  className,
  labelClassName,
}: SpanBarProps) {
  const [label, setLabel] = useState(shortLabel);
  const setShortLabel = () => {
    setLabel(shortLabel);
  };
  const setLongLabel = () => {
    setLabel(longLabel);
  };

  const styles = useStyles2(getStyles);

  let hintClassName: string;
  if (viewStart > 1 - viewEnd) {
    hintClassName = styles.labelLeft;
  } else {
    hintClassName = styles.labelRight;
  }

  return (
    <div
      className={`${styles.wrapper} ${className ?? ''}`}
      onClick={onClick}
      onMouseEnter={setLongLabel}
      onMouseLeave={setShortLabel}
      aria-hidden
    >
      <div
        className={styles.bar}
        style={{
          background: color,
          left: toPercent(viewStart),
          width: toPercent(viewEnd - viewStart),
        }}
      >
        <span className={`${styles.label} ${hintClassName} ${labelClassName ?? ''}`}>{label}</span>
      </div>
    </div>
  );
}

export default React.memo(SpanBar);
