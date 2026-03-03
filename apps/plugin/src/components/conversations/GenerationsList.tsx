import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import ChatMessage from '../chat/ChatMessage';
import { parseMessages } from '../../conversation/messageParser';
import type { GenerationDetail } from '../../conversation/types';

export type GenerationsListProps = {
  generations: GenerationDetail[];
};

function formatUsageValue(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toLocaleString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'generationsList-container',
    display: 'grid',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
  }),
  heading: css({
    label: 'generationsList-heading',
    margin: 0,
  }),
  list: css({
    label: 'generationsList-list',
    display: 'grid',
    gap: theme.spacing(1),
  }),
  empty: css({
    label: 'generationsList-empty',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  card: css({
    label: 'generationsList-card',
    display: 'grid',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  cardTitle: css({
    label: 'generationsList-cardTitle',
    margin: 0,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    overflowWrap: 'anywhere' as const,
  }),
  cardBody: css({
    label: 'generationsList-cardBody',
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
    alignItems: 'start',
    [`@media (max-width: ${theme.breakpoints.values.md}px)`]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  }),
  metaColumn: css({
    label: 'generationsList-metaColumn',
    display: 'grid',
    gap: theme.spacing(0.75),
  }),
  metaGrid: css({
    label: 'generationsList-metaGrid',
    display: 'grid',
    gap: theme.spacing(0.5),
    gridTemplateColumns: 'minmax(0, 1fr)',
  }),
  metaRow: css({
    label: 'generationsList-metaRow',
    display: 'grid',
    gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    overflowWrap: 'anywhere' as const,
  }),
  label: css({
    label: 'generationsList-label',
    color: theme.colors.text.secondary,
  }),
  value: css({
    label: 'generationsList-value',
    color: theme.colors.text.primary,
  }),
  chatColumn: css({
    label: 'generationsList-chatColumn',
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
  chatPanel: css({
    label: 'generationsList-chatPanel',
    display: 'grid',
    gap: theme.spacing(0.75),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    padding: theme.spacing(1),
    maxHeight: '520px',
    overflowY: 'auto' as const,
  }),
  rawFallback: css({
    label: 'generationsList-rawFallback',
    margin: 0,
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
    maxHeight: '260px',
    overflowY: 'auto' as const,
  }),
});

export default function GenerationsList({ generations }: GenerationsListProps) {
  const styles = useStyles2(getStyles);

  return (
    <section className={styles.container}>
      <h3 className={styles.heading}>Generations ({generations.length})</h3>
      {generations.length === 0 ? (
        <div className={styles.empty}>No generations found for this conversation.</div>
      ) : (
        <div className={styles.list}>
          {generations.map((generation, index) => {
            const inputMessages = parseMessages(generation.input);
            const outputMessages = parseMessages(generation.output);
            const inputRaw = generation.input != null ? JSON.stringify(generation.input, null, 2) : '';
            const outputRaw = generation.output != null ? JSON.stringify(generation.output, null, 2) : '';

            return (
              <article key={generation.generation_id} className={styles.card}>
                <h4 className={styles.cardTitle}>
                  {index + 1}. {generation.generation_id}
                </h4>
                <div className={styles.cardBody}>
                  <div className={styles.metaColumn}>
                    <div className={styles.metaGrid}>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Created</span>
                        <span className={styles.value}>{generation.created_at ?? 'n/a'}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Model</span>
                        <span className={styles.value}>
                          {generation.model?.provider ?? 'unknown-provider'} /{' '}
                          {generation.model?.name ?? 'unknown-model'}
                        </span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Mode</span>
                        <span className={styles.value}>{generation.mode ?? 'n/a'}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Trace ID</span>
                        <span className={styles.value}>{generation.trace_id ?? 'n/a'}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Input tokens</span>
                        <span className={styles.value}>{formatUsageValue(generation.usage?.input_tokens)}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Output tokens</span>
                        <span className={styles.value}>{formatUsageValue(generation.usage?.output_tokens)}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Total tokens</span>
                        <span className={styles.value}>{formatUsageValue(generation.usage?.total_tokens)}</span>
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.label}>Error</span>
                        <span className={styles.value}>{generation.error?.message ?? 'none'}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.chatColumn}>
                    <div className={styles.chatPanel}>
                      {inputMessages.length > 0 ? (
                        inputMessages.map((message, messageIndex) => (
                          <ChatMessage key={`${generation.generation_id}-input-${messageIndex}`} message={message} />
                        ))
                      ) : (
                        <pre className={styles.rawFallback}>{inputRaw.length > 0 ? inputRaw : 'No input messages'}</pre>
                      )}
                      {outputMessages.length > 0 ? (
                        outputMessages.map((message, messageIndex) => (
                          <ChatMessage key={`${generation.generation_id}-output-${messageIndex}`} message={message} />
                        ))
                      ) : (
                        <pre className={styles.rawFallback}>
                          {outputRaw.length > 0 ? outputRaw : 'No output messages'}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
