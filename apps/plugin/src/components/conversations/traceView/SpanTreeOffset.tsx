// Ported from Grafana's TraceView (Apache 2.0)
// Adapted to use SigilSpanTreeRow's ancestorSelectionIDs instead of TraceSpan.

import { css, cx } from '@emotion/css';
import React from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2) => ({
  SpanTreeOffset: css({
    color: theme.colors.text.primary,
    position: 'relative',
  }),
  SpanTreeOffsetParent: css({
    '&:hover': {
      cursor: 'pointer',
    },
  }),
  indentGuide: css({
    paddingRight: '1rem',
    height: '100%',
    display: 'inline-flex',
    transition: 'padding 300ms ease-out',
    '&::before': {
      content: '""',
      paddingLeft: '1px',
      backgroundColor: theme.colors.border.weak,
    },
  }),
  indentGuideActive: css({
    '&::before': {
      backgroundColor: theme.colors.text.secondary,
    },
  }),
  iconWrapper: css({
    position: 'absolute',
    right: 0,
    height: '100%',
    paddingTop: '1px',
    width: '1rem',
    textAlign: 'center',
  }),
});

export type SpanTreeOffsetProps = {
  childrenVisible?: boolean;
  onClick?: () => void;
  spanID: string;
  hasChildren: boolean;
  ancestorIDs: string[];
  showChildrenIcon?: boolean;
  hoverIndentGuideIDs: Set<string>;
  addHoverIndentGuideID: (spanID: string) => void;
  removeHoverIndentGuideID: (spanID: string) => void;
};

function SpanTreeOffset({
  childrenVisible = false,
  showChildrenIcon = true,
  onClick,
  spanID,
  hasChildren,
  ancestorIDs,
  hoverIndentGuideIDs,
  addHoverIndentGuideID,
  removeHoverIndentGuideID,
}: SpanTreeOffsetProps) {
  const styles = useStyles2(getStyles);

  const handleMouseEnter = React.useCallback(
    (event: React.MouseEvent<HTMLSpanElement>, ancestorID: string) => {
      if (
        !(event.relatedTarget instanceof HTMLSpanElement) ||
        (event.relatedTarget as HTMLSpanElement).dataset?.ancestorId !== ancestorID
      ) {
        addHoverIndentGuideID(ancestorID);
      }
    },
    [addHoverIndentGuideID]
  );

  const handleMouseLeave = React.useCallback(
    (event: React.MouseEvent<HTMLSpanElement>, ancestorID: string) => {
      if (
        !(event.relatedTarget instanceof HTMLSpanElement) ||
        (event.relatedTarget as HTMLSpanElement).dataset?.ancestorId !== ancestorID
      ) {
        removeHoverIndentGuideID(ancestorID);
      }
    },
    [removeHoverIndentGuideID]
  );

  const wrapperProps = hasChildren ? { onClick, role: 'switch' as const, 'aria-checked': childrenVisible } : null;
  const icon =
    showChildrenIcon &&
    hasChildren &&
    (childrenVisible ? <Icon name="angle-down" size="sm" /> : <Icon name="angle-right" size="sm" />);

  return (
    <span className={cx(styles.SpanTreeOffset, hasChildren && styles.SpanTreeOffsetParent)} {...wrapperProps}>
      {ancestorIDs.map((ancestorID) => (
        <span
          key={ancestorID}
          className={cx(styles.indentGuide, hoverIndentGuideIDs.has(ancestorID) && styles.indentGuideActive)}
          data-ancestor-id={ancestorID}
          onMouseEnter={(event) => handleMouseEnter(event, ancestorID)}
          onMouseLeave={(event) => handleMouseLeave(event, ancestorID)}
        />
      ))}
      <span
        className={styles.iconWrapper}
        onMouseEnter={(event) => {
          if (icon) {
            handleMouseEnter(event, spanID);
          }
        }}
        onMouseLeave={(event) => {
          if (icon) {
            handleMouseLeave(event, spanID);
          }
        }}
        data-testid="icon-wrapper"
      >
        {icon || '-'}
      </span>
    </span>
  );
}

export default React.memo(SpanTreeOffset);
