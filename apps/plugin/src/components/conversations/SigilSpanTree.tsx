import React, { useCallback, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { SpanType } from '../../conversation/spans';
import type { ConversationSpan } from '../../conversation/types';
import { buildSigilSpanTreeRows } from './jaegerTree/adapter';
import { collapseAll, collapseOne, expandAll, expandOne, filterVisibleRows } from './jaegerTree/collapseState';
import ListView from './jaegerTree/list/ListView';
import { buildServiceColorMap } from './jaegerTree/serviceColors';
import { SpanBarRow, TimelineHeaderRow } from './traceView';

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
const DEFAULT_SERVICE_COLOR = '#447EBC';

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
  }),
  viewport: css({
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  rowsWrapper: css({
    width: '100%',
  }),
  rowWrapper: css({
    width: '100%',
    position: 'relative',
    cursor: 'pointer',
  }),
  emptyState: css({
    color: theme.colors.text.secondary,
    padding: theme.spacing(1.5),
  }),
});

export default function SigilSpanTree({ spans, selectedSpanSelectionID = '', onSelectSpan }: SigilSpanTreeProps) {
  const styles = useStyles2(getStyles);
  const [childrenHiddenIDs, setChildrenHiddenIDs] = useState<Set<string>>(expandAll());
  const [hoverIndentGuideIDs, setHoverIndentGuideIDs] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const { rows } = useMemo(() => buildSigilSpanTreeRows(spans), [spans]);

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

  const visibleRows = useMemo(
    () => filterVisibleRows(rows, effectiveChildrenHiddenIDs),
    [rows, effectiveChildrenHiddenIDs]
  );
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

  const addHoverIndentGuideID = useCallback((spanID: string) => {
    setHoverIndentGuideIDs((current) => {
      const next = new Set(current);
      next.add(spanID);
      return next;
    });
  }, []);

  const removeHoverIndentGuideID = useCallback((spanID: string) => {
    setHoverIndentGuideIDs((current) => {
      const next = new Set(current);
      next.delete(spanID);
      return next;
    });
  }, []);

  const handleChildrenToggle = useCallback((spanID: string) => {
    setChildrenHiddenIDs((current) => {
      const next = new Set(current);
      if (next.has(spanID)) {
        next.delete(spanID);
      } else {
        next.add(spanID);
      }
      return next;
    });
  }, []);

  const handleDetailToggle = useCallback(
    (spanID: string) => {
      const row = rows.find((r) => r.selectionID === spanID);
      if (row) {
        onSelectSpan?.(row.span);
      }
    },
    [rows, onSelectSpan]
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <TimelineHeaderRow
        onCollapseAll={() => {
          setChildrenHiddenIDs(collapseAll(rows));
        }}
        onCollapseOne={() => {
          setChildrenHiddenIDs((current) => collapseOne(rows, current));
        }}
        onExpandAll={() => {
          setChildrenHiddenIDs(expandAll());
        }}
        onExpandOne={() => {
          setChildrenHiddenIDs((current) => expandOne(rows, current));
        }}
      />

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

              return (
                <div
                  key={itemKey}
                  {...attrs}
                  className={styles.rowWrapper}
                  style={{
                    ...style,
                    left: 0,
                    right: 0,
                    width: '100%',
                  }}
                >
                  <SpanBarRow
                    color={serviceColor}
                    isChildrenExpanded={isExpanded}
                    isSelected={isSelected}
                    onDetailToggled={handleDetailToggle}
                    onChildrenToggled={handleChildrenToggle}
                    showServiceName={showServiceName}
                    showErrorIcon={row.hasError}
                    spanID={row.selectionID}
                    operationName={row.operationName}
                    serviceName={row.serviceName}
                    hasChildren={row.hasChildren}
                    ancestorIDs={row.ancestorSelectionIDs}
                    hoverIndentGuideIDs={hoverIndentGuideIDs}
                    addHoverIndentGuideID={addHoverIndentGuideID}
                    removeHoverIndentGuideID={removeHoverIndentGuideID}
                    durationLabel={row.durationLabel}
                  />
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
