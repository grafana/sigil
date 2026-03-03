import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { GenerationDetail } from '../../conversation/types';
import ChatPreview from './ChatPreview';
import TokenCountInline from './TokenCountInline';
import { getGradientColorAtIndex } from './traceGradient';

export type GenerationItemProps = {
  generation: GenerationDetail;
  index: number;
  total: number;
  alwaysShowMetadata?: boolean;
  selectedTraceID?: string;
  onSelectTrace?: (traceID: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    label: 'generationItem-row',
    display: 'grid',
    gap: theme.spacing(0.75),
    gridTemplateColumns: '48px fit-content(760px) minmax(360px, 520px)',
    alignItems: 'start',
    position: 'relative' as const,
    [`@media (max-width: ${theme.breakpoints.values.md}px)`]: {
      gridTemplateColumns: '40px minmax(0, 1fr)',
    },
  }),
  numberColumn: css({
    label: 'generationItem-numberColumn',
    margin: 0,
    lineHeight: 1,
    fontSize: theme.typography.h2.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    textAlign: 'right' as const,
    paddingTop: theme.spacing(0.25),
    userSelect: 'none' as const,
  }),
  chatSection: css({
    label: 'generationItem-chatSection',
    display: 'grid',
    minWidth: 0,
  }),
  chatSurface: css({
    label: 'generationItem-chatSurface',
    minHeight: '120px',
    outline: 'none',
  }),
  metaColumn: css({
    label: 'generationItem-metaColumn',
    display: 'grid',
    gap: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    padding: theme.spacing(1.25),
    opacity: 0,
    pointerEvents: 'none' as const,
    transform: 'translateX(-8px)',
    transition: 'opacity 120ms ease, transform 120ms ease',
  }),
  metaGrid: css({
    label: 'generationItem-metaGrid',
    display: 'grid',
    gap: theme.spacing(0.75),
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  }),
  metaRow: css({
    label: 'generationItem-metaRow',
    display: 'grid',
    gap: theme.spacing(0.25),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  label: css({
    label: 'generationItem-label',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.2,
  }),
  labelWithMarker: css({
    label: 'generationItem-labelWithMarker',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  labelMarker: css({
    label: 'generationItem-labelMarker',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  }),
  value: css({
    label: 'generationItem-value',
    color: theme.colors.text.primary,
    overflowWrap: 'anywhere' as const,
    wordBreak: 'break-word' as const,
  }),
  traceButton: css({
    label: 'generationItem-traceButton',
    appearance: 'none',
    border: 'none',
    background: 'none',
    color: theme.colors.primary.text,
    cursor: 'pointer',
    textAlign: 'left' as const,
    padding: 0,
    margin: 0,
    font: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    '&:hover': {
      color: theme.colors.primary.main,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.border}`,
      borderRadius: theme.shape.radius.default,
      outlineOffset: '2px',
    },
  }),
  traceButtonActive: css({
    label: 'generationItem-traceButtonActive',
    color: theme.colors.primary.main,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  rowInteractive: css({
    label: 'generationItem-rowInteractive',
    '&:hover [data-generation-meta="true"], &:focus-within [data-generation-meta="true"]': {
      opacity: 1,
      pointerEvents: 'auto' as const,
      transform: 'translateX(0)',
    },
    [`@media (hover: none)`]: {
      '& [data-generation-meta="true"]': {
        opacity: 1,
        pointerEvents: 'auto' as const,
        transform: 'translateX(0)',
      },
    },
    [`@media (max-width: ${theme.breakpoints.values.md}px)`]: {
      '& [data-generation-meta="true"]': {
        gridColumn: '1 / -1',
      },
    },
  }),
  metaColumnVisible: css({
    label: 'generationItem-metaColumnVisible',
    opacity: 1,
    pointerEvents: 'auto' as const,
    transform: 'translateX(0)',
  }),
});

export default function GenerationItem({
  generation,
  index,
  total,
  alwaysShowMetadata = false,
  selectedTraceID,
  onSelectTrace,
}: GenerationItemProps) {
  const styles = useStyles2(getStyles);
  const generationColor = getGradientColorAtIndex(total, index, 0.82);
  const traceID = generation.trace_id ?? '';
  const hasTraceID = traceID.length > 0;
  const isSelectedTrace = hasTraceID && selectedTraceID === traceID;

  return (
    <article className={`${styles.row} ${styles.rowInteractive}`}>
      <p className={styles.numberColumn} style={{ color: generationColor }}>
        {index + 1}
      </p>

      <div className={styles.chatSection}>
        <div className={styles.chatSurface} tabIndex={0}>
          <ChatPreview
            generationID={generation.generation_id}
            input={generation.input}
            output={generation.output}
            borderless
          />
        </div>
      </div>

      <aside
        className={`${styles.metaColumn} ${alwaysShowMetadata ? styles.metaColumnVisible : ''}`}
        data-generation-meta="true"
        aria-label={`Generation ${index + 1} metadata`}
      >
        <div className={styles.metaGrid}>
          <div className={styles.metaRow}>
            <span className={`${styles.label} ${styles.labelWithMarker}`}>
              <span className={styles.labelMarker} style={{ background: generationColor }} />
              <span>Created</span>
            </span>
            <span className={styles.value}>{generation.created_at ?? 'n/a'}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.label}>Model</span>
            <span className={styles.value}>
              {generation.model?.provider ?? 'unknown-provider'} / {generation.model?.name ?? 'unknown-model'}
            </span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.label}>Mode</span>
            <span className={styles.value}>{generation.mode ?? 'n/a'}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.label}>Trace ID</span>
            <span className={styles.value}>
              {hasTraceID ? (
                <button
                  type="button"
                  className={`${styles.traceButton} ${isSelectedTrace ? styles.traceButtonActive : ''}`}
                  onClick={() => onSelectTrace?.(traceID)}
                  aria-label={`select trace ${traceID}`}
                >
                  {traceID}
                </button>
              ) : (
                'n/a'
              )}
            </span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.label}>Tokens</span>
            <span className={styles.value}>
              <TokenCountInline
                inputTokens={generation.usage?.input_tokens}
                outputTokens={generation.usage?.output_tokens}
                totalTokens={generation.usage?.total_tokens}
              />
            </span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.label}>Error</span>
            <span className={styles.value}>{generation.error?.message ?? 'none'}</span>
          </div>
        </div>
      </aside>
    </article>
  );
}
