import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';
import type { SigilSpan } from '../../conversation/traceSpans';
import SigilSpanNodeIcon from './SigilSpanNodeIcon';

type SigilSpanTreeProps = {
  spans: SigilSpan[];
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: SigilSpan) => void;
};

type TreeRow = {
  span: SigilSpan;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

const INDENT_PX = 14;
const TOGGLE_COL_WIDTH_PX = 18;

function sortSpanRows(left: SigilSpan, right: SigilSpan): number {
  if (left.startNs !== right.startNs) {
    return left.startNs < right.startNs ? -1 : 1;
  }
  if (left.durationNs !== right.durationNs) {
    return left.durationNs > right.durationNs ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

type SpanTree = {
  roots: SigilSpan[];
  childrenByParentID: Map<string, SigilSpan[]>;
};

function buildSpanTree(spans: SigilSpan[]): SpanTree {
  const bySpanID = new Map<string, SigilSpan>();
  const childrenByParentID = new Map<string, SigilSpan[]>();
  for (const span of spans) {
    if (span.spanID.length > 0) {
      bySpanID.set(span.spanID, span);
    }
  }
  for (const span of spans) {
    const parentID = span.parentSpanID;
    if (parentID.length === 0 || !bySpanID.has(parentID)) {
      continue;
    }
    const children = childrenByParentID.get(parentID);
    if (children != null) {
      children.push(span);
    } else {
      childrenByParentID.set(parentID, [span]);
    }
  }
  for (const [parentID, children] of childrenByParentID) {
    childrenByParentID.set(parentID, [...children].sort(sortSpanRows));
  }
  const roots = spans
    .filter((span) => span.parentSpanID.length === 0 || !bySpanID.has(span.parentSpanID))
    .sort(sortSpanRows);
  return { roots, childrenByParentID };
}

function buildVisibleRows(tree: SpanTree, expandedSpanIDs: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visited = new Set<string>();

  const walk = (span: SigilSpan, depth: number) => {
    const hasChildren = (tree.childrenByParentID.get(span.spanID)?.length ?? 0) > 0;
    const isExpanded = hasChildren && expandedSpanIDs.has(span.spanID);
    rows.push({ span, depth, hasChildren, isExpanded });
    if (!isExpanded) {
      return;
    }
    const visitKey = span.selectionID;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);
    const children = tree.childrenByParentID.get(span.spanID) ?? [];
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  for (const root of tree.roots) {
    walk(root, 0);
  }
  return rows;
}

const getStyles = (theme: GrafanaTheme2) => ({
  list: css({
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
  rowWrap: css({
    display: 'grid',
    gridTemplateColumns: `${TOGGLE_COL_WIDTH_PX}px minmax(0, 1fr) auto`,
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
  toggleButton: css({
    border: 0,
    background: 'transparent',
    padding: 0,
    width: `${TOGGLE_COL_WIDTH_PX}px`,
    height: `${TOGGLE_COL_WIDTH_PX}px`,
    color: theme.colors.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  toggleSpacer: css({
    width: `${TOGGLE_COL_WIDTH_PX}px`,
    height: `${TOGGLE_COL_WIDTH_PX}px`,
  }),
  row: css({
    border: 0,
    background: 'transparent',
    padding: theme.spacing(0.25, 0.5),
    textAlign: 'left' as const,
    cursor: 'pointer',
    width: '100%',
    minWidth: 0,
    borderRadius: '2px',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    color: theme.colors.text.primary,
  }),
  rowMain: css({
    minWidth: 0,
  }),
  rowName: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
  rowNameSelected: css({
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  rowMeta: css({
    marginLeft: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  icon: css({
    color: theme.colors.text.secondary,
  }),
  kindLabel: css({
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.02em',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export default function SigilSpanTree({
  spans,
  selectedSpanSelectionID = '',
  onSelectSpan,
}: SigilSpanTreeProps) {
  const styles = useStyles2(getStyles);
  const tree = useMemo(() => buildSpanTree(spans), [spans]);
  const [expandedSpanIDs, setExpandedSpanIDs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const availableSpanIDs = new Set(spans.map((span) => span.spanID).filter((spanID) => spanID.length > 0));
    setExpandedSpanIDs((current) => {
      const next = new Set<string>();
      for (const spanID of current) {
        if (availableSpanIDs.has(spanID)) {
          next.add(spanID);
        }
      }
      return next;
    });
  }, [spans]);

  const rows = useMemo(() => buildVisibleRows(tree, expandedSpanIDs), [tree, expandedSpanIDs]);

  return (
    <div className={styles.list}>
      {rows.map(({ span, depth, hasChildren, isExpanded }) => {
        const isSelected = selectedSpanSelectionID === span.selectionID;
        return (
          <div key={span.selectionID} className={styles.rowWrap}>
            {hasChildren ? (
              <button
                type="button"
                className={styles.toggleButton}
                aria-label={`${isExpanded ? 'collapse' : 'expand'} span ${span.name}`}
                aria-expanded={isExpanded}
                onClick={() => {
                  setExpandedSpanIDs((current) => {
                    const next = new Set(current);
                    if (next.has(span.spanID)) {
                      next.delete(span.spanID);
                    } else {
                      next.add(span.spanID);
                    }
                    return next;
                  });
                }}
              >
                <Icon name={isExpanded ? 'angle-down' : 'angle-right'} size="sm" />
              </button>
            ) : (
              <span className={styles.toggleSpacer} />
            )}
            <button
              type="button"
              className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
              aria-pressed={isSelected}
              aria-level={depth + 1}
              aria-expanded={hasChildren ? isExpanded : undefined}
              aria-label={`select span ${span.name}`}
              onClick={() => {
                onSelectSpan?.(span);
                if (depth === 0 && hasChildren && !isExpanded) {
                  setExpandedSpanIDs((current) => new Set(current).add(span.spanID));
                }
              }}
              style={{ paddingLeft: `${depth * INDENT_PX}px` }}
            >
              <div className={styles.rowMain}>
                <div className={`${styles.rowName} ${isSelected ? styles.rowNameSelected : ''}`}>
                  <SigilSpanNodeIcon kind={span.sigilKind} className={styles.icon} />
                  <span>{span.name}</span>
                  <span className={styles.rowMeta}>({span.serviceName})</span>
                </div>
              </div>
            </button>
            <span className={styles.kindLabel}>{span.sigilKind === 'other' ? '' : span.sigilKind}</span>
          </div>
        );
      })}
    </div>
  );
}
