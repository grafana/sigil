import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';
import type { SpanType } from '../../conversation/spans';
import type { ConversationSpan } from '../../conversation/types';
import { buildSigilSpanTreeRows, type SigilSpanTreeRow } from './jaegerTree/adapter';
import { collapseAll, collapseOne, expandAll, expandOne, filterVisibleRows } from './jaegerTree/collapseState';
import ListView from './jaegerTree/list/ListView';
import { buildServiceColorMap, withAlpha } from './jaegerTree/serviceColors';

type SigilSpanTreeProps = {
  spans: ConversationSpan[];
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: ConversationSpan) => void;
  renderNode?: (context: SigilSpanTreeNodeRenderContext) => React.ReactNode;
};

export type SigilSpanTreeNodeRenderContext = {
  span: ConversationSpan;
  selectionID: string;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  spanType: SpanType;
  serviceName: string;
  operationName: string;
  durationLabel: string;
  hasError: boolean;
  showServiceName: boolean;
};

const ROW_HEIGHT_PX = 28;
const HEADER_HEIGHT_PX = 38;
const VIEWPORT_HEIGHT_PX = 460;
const DEFAULT_SERVICE_COLOR = '#447EBC';

function isLastChild(row: SigilSpanTreeRow, rowsBySelectionID: Map<string, SigilSpanTreeRow>): boolean {
  if (!row.parentSelectionID) {
    return false;
  }
  const parent = rowsBySelectionID.get(row.parentSelectionID);
  if (!parent || parent.childSelectionIDs.length === 0) {
    return false;
  }
  return parent.childSelectionIDs[parent.childSelectionIDs.length - 1] === row.selectionID;
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    overflow: 'hidden',
  }),
  header: css({
    alignItems: 'center',
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.primary,
    display: 'flex',
    gap: theme.spacing(1),
    height: `${HEADER_HEIGHT_PX}px`,
    lineHeight: `${HEADER_HEIGHT_PX}px`,
    padding: theme.spacing(0, 1),
    position: 'relative',
    width: '100%',
    zIndex: 3,
  }),
  headerTitle: css({
    flex: 1,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  controls: css({
    alignItems: 'center',
    display: 'flex',
    flex: 'none',
    justifyContent: 'center',
    marginRight: '0.5rem',
  }),
  controlButton: css({
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    display: 'inline-flex',
    justifyContent: 'center',
    marginRight: '0.2rem',
    padding: '0.1rem',
    '&:hover': {
      color: theme.colors.primary.main,
    },
  }),
  controlButtonDown: css({
    transform: 'rotate(90deg)',
  }),
  controlButtonSmall: css({
    fontSize: '22px',
  }),
  controlButtonLarge: css({
    fontSize: '24px',
  }),
  viewport: css({
    height: `${VIEWPORT_HEIGHT_PX}px`,
  }),
  rowsWrapper: css({
    width: '100%',
  }),
  row: css({
    width: '100%',
    position: 'relative',
    '&:hover .jaeger-tree-name-wrapper': {
      borderRight: `1px solid ${theme.colors.border.medium}`,
      float: 'left',
      minWidth: 'calc(100% + 1px)',
      overflow: 'visible',
      background: `linear-gradient(90deg, ${theme.colors.background.secondary}, ${theme.colors.background.primary} 75%, ${theme.colors.background.primary})`,
    },
  }),
  rowSelected: css({
    background: theme.colors.primary.transparent,
  }),
  rowError: css({
    background: theme.colors.error.transparent,
  }),
  nameColumn: css({
    position: 'relative',
    whiteSpace: 'nowrap',
    width: '100%',
    zIndex: 1,
  }),
  nameWrapper: css({
    background: theme.colors.background.primary,
    display: 'flex',
    lineHeight: '27px',
    overflow: 'hidden',
  }),
  treeOffset: css({
    alignItems: 'center',
    color: theme.colors.text.primary,
    display: 'flex',
    height: `${ROW_HEIGHT_PX}px`,
    paddingLeft: '10px',
    position: 'relative',
  }),
  treeOffsetParent: css({
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      cursor: 'pointer',
    },
  }),
  indentGuide: css({
    alignItems: 'center',
    color: 'currentColor',
    display: 'inline-flex',
    flexShrink: 0,
    height: '100%',
    position: 'relative',
    width: 'calc(0.5rem + 20px)',
    '&::after': {
      backgroundColor: 'currentColor',
      content: '""',
      height: '100%',
      left: 'calc(0.25rem + 9.5px)',
      position: 'absolute',
      width: '1px',
    },
  }),
  indentGuideLast: css({
    '&::after': {
      height: '50%',
      top: 0,
    },
  }),
  indentGuideTerminated: css({
    '&::after': {
      display: 'none',
    },
  }),
  indentGuideActive: css({
    filter: 'brightness(1.2)',
  }),
  horizontalLine: css({
    backgroundColor: 'inherit',
    height: '1px',
    left: 'calc(0.25rem + 9.5px)',
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 'calc(0.25rem + 10.5px)',
  }),
  iconWrapper: css({
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    justifyContent: 'center',
    position: 'relative',
    width: '20px',
  }),
  childrenToggle: css({
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    display: 'inline-flex',
    height: '20px',
    justifyContent: 'center',
    padding: 0,
    width: '20px',
    '&:hover': {
      color: theme.colors.text.primary,
    },
  }),
  leafDash: css({
    color: theme.colors.text.disabled,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1,
  }),
  rowButton: css({
    background: 'transparent',
    border: 0,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    flex: '1 1 auto',
    minWidth: 0,
    outline: 'none',
    overflow: 'hidden',
    paddingRight: '0.25em',
    position: 'relative',
    textAlign: 'left',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '&::after': {
      background: 'transparent',
      bottom: 0,
      content: '" "',
      left: 0,
      position: 'absolute',
      top: 0,
      width: '1000px',
    },
  }),
  rowButtonSelected: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  serviceName: css({
    fontSize: '1.05em',
    padding: '0 0.25rem 0 0.5rem',
  }),
  operationName: css({
    color: theme.colors.text.secondary,
    paddingRight: theme.spacing(0.5),
  }),
  duration: css({
    color: theme.colors.text.secondary,
  }),
  errorIcon: css({
    background: '#db2828',
    borderRadius: '6.5px',
    color: '#fff',
    fontSize: '0.85em',
    marginRight: '0.25rem',
    padding: '1px',
    verticalAlign: 'middle',
  }),
  emptyState: css({
    color: theme.colors.text.secondary,
    padding: theme.spacing(1.5),
  }),
});

function defaultNodeRenderer(styles: ReturnType<typeof getStyles>, context: SigilSpanTreeNodeRenderContext): React.ReactNode {
  return (
    <>
      {context.hasError && <Icon name="exclamation-circle" size="sm" className={styles.errorIcon} />}
      {context.showServiceName && <span className={styles.serviceName}>{context.serviceName}</span>}
      <small className={styles.operationName}>{context.operationName}</small>
      <span className={styles.duration}>({context.durationLabel})</span>
    </>
  );
}

export default function SigilSpanTree({
  spans,
  selectedSpanSelectionID = '',
  onSelectSpan,
  renderNode,
}: SigilSpanTreeProps) {
  const styles = useStyles2(getStyles);
  const [childrenHiddenIDs, setChildrenHiddenIDs] = useState<Set<string>>(expandAll());
  const [hoverIndentGuideIDs, setHoverIndentGuideIDs] = useState<Set<string>>(new Set());

  const rows = useMemo(() => buildSigilSpanTreeRows(spans), [spans]);
  const rowsBySelectionID = useMemo(() => {
    const map = new Map<string, SigilSpanTreeRow>();
    for (const row of rows) {
      map.set(row.selectionID, row);
    }
    return map;
  }, [rows]);

  const effectiveChildrenHiddenIDs = useMemo(() => {
    const validCollapsibleIDs = new Set(rows.filter((row) => row.hasChildren).map((row) => row.selectionID));
    const next = new Set<string>();
    for (const selectionID of childrenHiddenIDs) {
      if (validCollapsibleIDs.has(selectionID)) {
        next.add(selectionID);
      }
    }
    return next;
  }, [childrenHiddenIDs, rows]);

  const visibleRows = useMemo(() => filterVisibleRows(rows, effectiveChildrenHiddenIDs), [rows, effectiveChildrenHiddenIDs]);
  const serviceColorMap = useMemo(() => buildServiceColorMap(rows.map((row) => row.serviceName)), [rows]);

  const indexByKey = useMemo(() => {
    const indexMap = new Map<string, number>();
    for (let index = 0; index < visibleRows.length; index += 1) {
      indexMap.set(visibleRows[index].selectionID, index);
    }
    return indexMap;
  }, [visibleRows]);

  const redraw = useMemo(
    () => ({
      rowCount: visibleRows.length,
      selectedSpanSelectionID,
      collapsed: Array.from(effectiveChildrenHiddenIDs).join(','),
    }),
    [visibleRows.length, selectedSpanSelectionID, effectiveChildrenHiddenIDs]
  );

  const handleIndentMouseEnter = (event: React.MouseEvent<HTMLSpanElement>, ancestorSelectionID: string) => {
    if (
      !(event.relatedTarget instanceof HTMLSpanElement) ||
      event.relatedTarget.dataset.ancestorId !== ancestorSelectionID
    ) {
      setHoverIndentGuideIDs((current) => {
        const next = new Set(current);
        next.add(ancestorSelectionID);
        return next;
      });
    }
  };

  const handleIndentMouseLeave = (event: React.MouseEvent<HTMLSpanElement>, ancestorSelectionID: string) => {
    if (
      !(event.relatedTarget instanceof HTMLSpanElement) ||
      event.relatedTarget.dataset.ancestorId !== ancestorSelectionID
    ) {
      setHoverIndentGuideIDs((current) => {
        const next = new Set(current);
        next.delete(ancestorSelectionID);
        return next;
      });
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.headerTitle}>Service &amp; Operation</h3>
        <div className={styles.controls}>
          <button
            type="button"
            className={cx(styles.controlButton, styles.controlButtonSmall, styles.controlButtonDown)}
            aria-label="Expand +1"
            onClick={() => {
              setChildrenHiddenIDs((current) => expandOne(rows, current));
            }}
          >
            <Icon name="angle-right" />
          </button>
          <button
            type="button"
            className={cx(styles.controlButton, styles.controlButtonSmall)}
            aria-label="Collapse +1"
            onClick={() => {
              setChildrenHiddenIDs((current) => collapseOne(rows, current));
            }}
          >
            <Icon name="angle-right" />
          </button>
          <button
            type="button"
            className={cx(styles.controlButton, styles.controlButtonLarge, styles.controlButtonDown)}
            aria-label="Expand all"
            onClick={() => {
              setChildrenHiddenIDs(expandAll());
            }}
          >
            <Icon name="angle-double-right" />
          </button>
          <button
            type="button"
            className={cx(styles.controlButton, styles.controlButtonLarge)}
            aria-label="Collapse all"
            onClick={() => {
              setChildrenHiddenIDs(collapseAll(rows));
            }}
          >
            <Icon name="angle-double-right" />
          </button>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className={styles.emptyState}>No spans to display.</div>
      ) : (
        <div className={styles.viewport}>
          <ListView
            dataLength={visibleRows.length}
            getIndexFromKey={(key) => indexByKey.get(key) ?? -1}
            getKeyFromIndex={(index) => visibleRows[index]?.selectionID ?? `row-${index}`}
            itemHeightGetter={() => ROW_HEIGHT_PX}
            viewBuffer={300}
            viewBufferMin={100}
            redraw={redraw}
            itemsWrapperClassName={styles.rowsWrapper}
            itemRenderer={(itemKey, style, index, attrs) => {
              const row = visibleRows[index];
              if (!row) {
                return null;
              }

              const previousRow = index > 0 ? visibleRows[index - 1] : null;
              const showServiceName = previousRow == null || previousRow.serviceName !== row.serviceName;
              const isSelected = selectedSpanSelectionID === row.selectionID;
              const isExpanded = row.hasChildren && !effectiveChildrenHiddenIDs.has(row.selectionID);
              const serviceColor = serviceColorMap.get(row.serviceName) ?? DEFAULT_SERVICE_COLOR;
              const parentColor = row.parentSelectionID
                ? serviceColorMap.get(rowsBySelectionID.get(row.parentSelectionID)?.serviceName ?? '') ?? serviceColor
                : serviceColor;

              const nodeContext: SigilSpanTreeNodeRenderContext = {
                span: row.span,
                selectionID: row.selectionID,
                depth: row.depth,
                isSelected,
                isExpanded,
                hasChildren: row.hasChildren,
                spanType: row.spanType,
                serviceName: row.serviceName,
                operationName: row.operationName,
                durationLabel: row.durationLabel,
                hasError: row.hasError,
                showServiceName,
              };

              return (
                <div
                  key={itemKey}
                  {...attrs}
                  className={cx(styles.row, isSelected && styles.rowSelected, row.hasError && styles.rowError)}
                  style={{
                    ...style,
                    left: 0,
                    right: 0,
                    width: '100%',
                    borderBottom: `1px solid ${withAlpha(serviceColor, '9C')}`,
                  }}
                >
                  <div className={styles.nameColumn}>
                    <div className={cx('jaeger-tree-name-wrapper', styles.nameWrapper)}>
                      <span className={cx(styles.treeOffset, row.hasChildren && styles.treeOffsetParent)}>
                        {row.ancestorSelectionIDs.map((ancestorSelectionID, ancestorIndex) => {
                          const ancestorRow = rowsBySelectionID.get(ancestorSelectionID);
                          const guideColor = serviceColorMap.get(ancestorRow?.serviceName ?? row.serviceName) ?? serviceColor;
                          const isLastAncestor = ancestorIndex === row.ancestorSelectionIDs.length - 1;
                          const descendantSelectionID = row.ancestorSelectionIDs[ancestorIndex + 1];
                          const descendantRow = descendantSelectionID
                            ? rowsBySelectionID.get(descendantSelectionID)
                            : undefined;
                          const shouldTerminate = isLastAncestor
                            ? isLastChild(row, rowsBySelectionID)
                            : descendantRow
                              ? isLastChild(descendantRow, rowsBySelectionID)
                              : false;

                          return (
                            <span
                              key={`${row.selectionID}:${ancestorSelectionID}`}
                              className={cx(
                                styles.indentGuide,
                                isLastAncestor && isLastChild(row, rowsBySelectionID) && styles.indentGuideLast,
                                shouldTerminate && !isLastAncestor && styles.indentGuideTerminated,
                                hoverIndentGuideIDs.has(ancestorSelectionID) && styles.indentGuideActive
                              )}
                              style={{ color: guideColor }}
                              data-ancestor-id={ancestorSelectionID}
                              onMouseEnter={(event) => handleIndentMouseEnter(event, ancestorSelectionID)}
                              onMouseLeave={(event) => handleIndentMouseLeave(event, ancestorSelectionID)}
                            >
                              {isLastAncestor && <span className={styles.horizontalLine} style={{ backgroundColor: parentColor }} />}
                            </span>
                          );
                        })}

                        <span className={styles.iconWrapper}>
                          {row.hasChildren ? (
                            <button
                              type="button"
                              className={styles.childrenToggle}
                              aria-label={`${isExpanded ? 'collapse' : 'expand'} span ${row.operationName}`}
                              aria-expanded={isExpanded}
                              onClick={() => {
                                setChildrenHiddenIDs((current) => {
                                  const next = new Set(current);
                                  if (next.has(row.selectionID)) {
                                    next.delete(row.selectionID);
                                  } else {
                                    next.add(row.selectionID);
                                  }
                                  return next;
                                });
                              }}
                            >
                              <Icon name={isExpanded ? 'angle-down' : 'angle-right'} size="sm" />
                            </button>
                          ) : (
                            <span className={styles.leafDash}>-</span>
                          )}
                        </span>
                      </span>

                      <button
                        type="button"
                        className={cx('jaeger-tree-row-button', styles.rowButton, isSelected && styles.rowButtonSelected)}
                        aria-pressed={isSelected}
                        aria-level={row.depth + 1}
                        aria-expanded={row.hasChildren ? isExpanded : undefined}
                        aria-label={`select span ${row.operationName}`}
                        onClick={() => {
                          onSelectSpan?.(row.span);
                        }}
                        style={{
                          borderColor: serviceColor,
                        }}
                      >
                        {renderNode ? renderNode(nodeContext) : defaultNodeRenderer(styles, nodeContext)}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
