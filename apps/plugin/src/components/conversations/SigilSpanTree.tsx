import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { SigilSpan } from '../../conversation/traceSpans';
import SigilSpanNodeIcon from './SigilSpanNodeIcon';

type SigilSpanTreeProps = {
  spans: SigilSpan[];
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: SigilSpan) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  list: css({
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
  row: css({
    border: 0,
    background: 'transparent',
    padding: theme.spacing(0.25, 0),
    textAlign: 'left' as const,
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    color: theme.colors.primary.text,
  }),
  rowMain: css({
    minWidth: 0,
  }),
  rowName: css({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
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

  return (
    <div className={styles.list}>
      {spans.map((span) => {
        const isSelected = selectedSpanSelectionID === span.selectionID;
        return (
          <button
            key={span.selectionID}
            type="button"
            className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
            aria-pressed={isSelected}
            aria-label={`select span ${span.name}`}
            onClick={() => onSelectSpan?.(span)}
          >
            <SigilSpanNodeIcon kind={span.sigilKind} className={styles.icon} />
            <div className={styles.rowMain}>
              <div className={styles.rowName}>
                <span>{span.name}</span>
                <span className={styles.rowMeta}>({span.serviceName})</span>
              </div>
            </div>
            <span className={styles.kindLabel}>{span.sigilKind === 'other' ? '' : span.sigilKind}</span>
          </button>
        );
      })}
    </div>
  );
}
