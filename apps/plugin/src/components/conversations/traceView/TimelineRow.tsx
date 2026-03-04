// Ported from Grafana's TraceView (Apache 2.0)

import { css, cx } from '@emotion/css';
import React from 'react';
import { useStyles2 } from '@grafana/ui';

const getStyles = () => ({
  row: css({
    display: 'flex',
    flex: '0 1 auto',
    flexDirection: 'row',
  }),
  rowCell: css({
    position: 'relative',
  }),
});

type TimelineRowProps = {
  children: React.ReactNode;
  className?: string;
};

interface TimelineRowCellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  width: number;
  style?: React.CSSProperties;
}

export default function TimelineRow({ children, className = '', ...rest }: TimelineRowProps) {
  const styles = useStyles2(getStyles);
  return (
    <div className={cx(styles.row, className)} {...rest}>
      {children}
    </div>
  );
}

export function TimelineRowCell({ children, className = '', width, style = {}, ...rest }: TimelineRowCellProps) {
  const widthPercent = `${width * 100}%`;
  const mergedStyle = { ...style, flexBasis: widthPercent, maxWidth: widthPercent };
  const styles = useStyles2(getStyles);
  return (
    <div className={cx(styles.rowCell, className)} style={mergedStyle} {...rest}>
      {children}
    </div>
  );
}

TimelineRow.Cell = TimelineRowCell;
