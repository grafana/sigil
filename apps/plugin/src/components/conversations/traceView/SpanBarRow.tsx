// Ported from Grafana's TraceView (Apache 2.0)
// Simplified: no span bars, no ticks, no span links, no filter matching.
// Right column shows duration label only.

import { css, cx } from '@emotion/css';
import React from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';

import SpanTreeOffset from './SpanTreeOffset';

const nameWrapperClassName = 'nameWrapper';
const nameColumnClassName = 'nameColumn';

const getStyles = (theme: GrafanaTheme2, serviceColor: string) => ({
  nameWrapper: css({
    label: 'nameWrapper',
    lineHeight: '27px',
    overflow: 'hidden',
    display: 'flex',
    '& > *': {
      background: theme.colors.background.secondary,
    },
  }),
  nameColumn: css({
    label: 'nameColumn',
    position: 'relative',
    whiteSpace: 'nowrap',
    zIndex: 1,
    '&:hover': {
      zIndex: 1,
    },
  }),
  endpointName: css({
    color: theme.colors.text.secondary,
    fontSize: '0.9em',
  }),
  row: css({
    label: 'row',
    display: 'flex',
    flex: '0 1 auto',
    flexDirection: 'row',
    fontSize: '0.9em',
    ['& .icon-wrapper']: {
      borderBottomColor: `${serviceColor}CF`,
      borderBottomWidth: '2px',
      borderBottomStyle: 'solid',
    },
  }),
  rowClippingLeft: css({
    [`& .${nameColumnClassName}::before`]: {
      content: '" "',
      height: '100%',
      position: 'absolute',
      width: '6px',
      backgroundImage: `linear-gradient(to right, rgba(25, 25, 25, 0.25), rgba(32, 32, 32, 0))`,
      left: '100%',
      zIndex: -1,
    },
  }),
  rowExpanded: css({
    [`& .${nameWrapperClassName}, &:hover .${nameWrapperClassName}`]: {
      background: theme.colors.action.hover,
      boxShadow: `0 1px 0 ${theme.colors.border.weak}`,
    },
  }),
  rowError: css({
    [`&:hover .${nameWrapperClassName}`]: {
      background: theme.colors.error.transparent,
    },
    [`& .${nameWrapperClassName} > *`]: {
      background: theme.colors.error.transparent,
    },
  }),
  name: css({
    color: theme.colors.text.primary,
    cursor: 'pointer',
    flex: '1 1 auto',
    outline: 'none',
    overflowY: 'hidden',
    overflowX: 'auto',
    padding: '4px',
    position: 'relative',
    msOverflowStyle: 'none',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
    '&:focus': {
      textDecoration: 'none',
    },
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    borderBottomColor: `${serviceColor}CF`,
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
  }),
  svcName: css({
    fontSize: '0.9em',
    fontWeight: 500,
    marginRight: '0.25rem',
  }),
  svcNameChildrenCollapsed: css({
    fontWeight: 500,
    fontStyle: 'italic',
  }),
  errorIcon: css({
    borderRadius: theme.shape.radius.default,
    color: '#fff',
    fontSize: '0.6em',
    marginRight: '0.25rem',
    padding: '1px',
  }),
});

export type SpanBarRowProps = {
  className?: string;
  color: string;
  isChildrenExpanded: boolean;
  onDetailToggled: (spanID: string) => void;
  onChildrenToggled: (spanID: string) => void;
  showServiceName: boolean;
  showErrorIcon: boolean;
  spanID: string;
  operationName: string;
  serviceName: string;
  hasChildren: boolean;
  ancestorIDs: string[];
  hoverIndentGuideIDs: Set<string>;
  addHoverIndentGuideID: (spanID: string) => void;
  removeHoverIndentGuideID: (spanID: string) => void;
  clippingLeft?: boolean;
  durationLabel: string;
  isSelected?: boolean;
};

function SpanBarRow(props: SpanBarRowProps) {
  const {
    className = '',
    color,
    isChildrenExpanded,
    showErrorIcon,
    spanID,
    operationName,
    serviceName,
    hasChildren,
    ancestorIDs,
    hoverIndentGuideIDs,
    addHoverIndentGuideID,
    removeHoverIndentGuideID,
    clippingLeft,
    showServiceName,
    onDetailToggled,
    onChildrenToggled,
    durationLabel,
    isSelected,
  } = props;

  const styles = useStyles2(getStyles, color);

  const handleDetailToggle = React.useCallback(() => {
    onDetailToggled(spanID);
  }, [onDetailToggled, spanID]);

  const handleChildrenToggle = React.useCallback(() => {
    onChildrenToggled(spanID);
  }, [onChildrenToggled, spanID]);

  return (
    <div
      className={cx(
        styles.row,
        className,
        clippingLeft && styles.rowClippingLeft,
        showErrorIcon && styles.rowError,
        isSelected && styles.rowExpanded
      )}
    >
      <div className={cx(nameColumnClassName, styles.nameColumn)}>
        <div className={cx(nameWrapperClassName, styles.nameWrapper)}>
          <SpanTreeOffset
            childrenVisible={isChildrenExpanded}
            spanID={spanID}
            hasChildren={hasChildren}
            ancestorIDs={ancestorIDs}
            onClick={handleChildrenToggle}
            hoverIndentGuideIDs={hoverIndentGuideIDs}
            addHoverIndentGuideID={addHoverIndentGuideID}
            removeHoverIndentGuideID={removeHoverIndentGuideID}
          />
          <button
            type="button"
            className={cx('icon-wrapper', styles.name)}
            onClick={handleDetailToggle}
            aria-label={`select span ${operationName}`}
          >
            {showErrorIcon && (
              <Icon name="exclamation-circle" style={{ background: '#db2828' }} className={styles.errorIcon} />
            )}
            {showServiceName && (
              <span
                className={cx(styles.svcName, !isChildrenExpanded && hasChildren && styles.svcNameChildrenCollapsed)}
              >
                {serviceName}{' '}
              </span>
            )}
            <span className={styles.endpointName}>{operationName}</span> <small>({durationLabel})</small>
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(SpanBarRow);
