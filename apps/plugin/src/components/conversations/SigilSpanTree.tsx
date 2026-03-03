import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';
import type { ConversationSpan } from '../../conversation/types';
import { getSelectionID, getSpanType } from '../../conversation/spans';
import SigilSpanNodeIcon from './SigilSpanNodeIcon';

type SigilSpanTreeProps = {
  spans: ConversationSpan[];
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: ConversationSpan) => void;
};

type TreeRow = {
  span: ConversationSpan;
  selectionID: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

const INDENT_PX = 14;
const TOGGLE_COL_WIDTH_PX = 18;

function buildVisibleRows(roots: ConversationSpan[], expandedKeys: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visited = new Set<string>();

  function walk(span: ConversationSpan, depth: number): void {
    const selID = getSelectionID(span);
    const hasChildren = span.children.length > 0;
    const isExpanded = hasChildren && expandedKeys.has(selID);
    rows.push({ span, selectionID: selID, depth, hasChildren, isExpanded });
    if (!isExpanded) {
      return;
    }
    if (visited.has(selID)) {
      return;
    }
    visited.add(selID);
    for (const child of span.children) {
      walk(child, depth + 1);
    }
  }

  for (const root of roots) {
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

export default function SigilSpanTree({ spans, selectedSpanSelectionID = '', onSelectSpan }: SigilSpanTreeProps) {
  const styles = useStyles2(getStyles);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const allKeys = useMemo(() => {
    const next = new Set<string>();
    function collectKeys(list: ConversationSpan[]): void {
      for (const span of list) {
        next.add(getSelectionID(span));
        collectKeys(span.children);
      }
    }
    collectKeys(spans);
    return next;
  }, [spans]);

  const visibleExpandedKeys = useMemo(() => {
    const next = new Set<string>();
    for (const key of expandedKeys) {
      if (allKeys.has(key)) {
        next.add(key);
      }
    }
    return next;
  }, [allKeys, expandedKeys]);

  const rows = useMemo(() => buildVisibleRows(spans, visibleExpandedKeys), [spans, visibleExpandedKeys]);

  return (
    <div className={styles.list}>
      {rows.map(({ span, selectionID, depth, hasChildren, isExpanded }) => {
        const isSelected = selectedSpanSelectionID === selectionID;
        const spanType = getSpanType(span);
        return (
          <div key={selectionID} className={styles.rowWrap}>
            {hasChildren ? (
              <button
                type="button"
                className={styles.toggleButton}
                aria-label={`${isExpanded ? 'collapse' : 'expand'} span ${span.name}`}
                aria-expanded={isExpanded}
                onClick={() => {
                  setExpandedKeys((current) => {
                    const next = new Set(current);
                    if (next.has(selectionID)) {
                      next.delete(selectionID);
                    } else {
                      next.add(selectionID);
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
                  setExpandedKeys((current) => new Set(current).add(selectionID));
                }
              }}
              style={{ paddingLeft: `${depth * INDENT_PX}px` }}
            >
              <div className={styles.rowMain}>
                <div className={`${styles.rowName} ${isSelected ? styles.rowNameSelected : ''}`}>
                  <SigilSpanNodeIcon type={spanType} className={styles.icon} />
                  <span>{span.name}</span>
                  <span className={styles.rowMeta}>({span.serviceName})</span>
                </div>
              </div>
            </button>
            <span className={styles.kindLabel}>{spanType === 'unknown' ? '' : spanType}</span>
          </div>
        );
      })}
    </div>
  );
}
