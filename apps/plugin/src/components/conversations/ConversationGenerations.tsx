import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Spinner, Text, useStyles2 } from '@grafana/ui';
import type { GenerationDetail } from '../../conversation/types';

export type ConversationGenerationsProps = {
  generations: GenerationDetail[];
  loading?: boolean;
  errorMessage?: string;
};

function formatTimestamp(value?: string): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function formatModel(value: GenerationDetail): string {
  if (value.model?.provider && value.model?.name) {
    return `${value.model.provider}/${value.model.name}`;
  }
  return value.model?.name ?? '-';
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTokenUsage(value: GenerationDetail): string {
  const usage = value.usage as Record<string, unknown> | undefined;
  if (!usage) {
    return '-';
  }
  const totalTokens = parseNumericValue(usage.total_tokens ?? usage.totalTokens);
  if (totalTokens != null) {
    return totalTokens.toLocaleString();
  }
  const inputTokens = parseNumericValue(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = parseNumericValue(usage.output_tokens ?? usage.outputTokens);
  if (inputTokens != null || outputTokens != null) {
    return `${inputTokens ?? 0}/${outputTokens ?? 0}`;
  }
  return '-';
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'conversationGenerations-container',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    minHeight: 0,
    padding: theme.spacing(0, 0.5, 1.5, 0.75),
  }),
  title: css({
    label: 'conversationGenerations-title',
    margin: 0,
    fontSize: theme.typography.h6.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  table: css({
    label: 'conversationGenerations-table',
    width: '100%',
    borderCollapse: 'collapse' as const,
  }),
  headerRow: css({
    label: 'conversationGenerations-headerRow',
    borderBottom: `1px solid ${theme.colors.border.medium}`,
  }),
  headerCell: css({
    label: 'conversationGenerations-headerCell',
    textAlign: 'left' as const,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase' as const,
    padding: theme.spacing(0.75, 1),
    whiteSpace: 'nowrap' as const,
  }),
  row: css({
    label: 'conversationGenerations-row',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  rowError: css({
    label: 'conversationGenerations-rowError',
    background: theme.colors.error.transparent,
  }),
  cell: css({
    label: 'conversationGenerations-cell',
    padding: theme.spacing(0.75, 1),
    fontSize: theme.typography.bodySmall.fontSize,
    verticalAlign: 'top' as const,
  }),
  generationID: css({
    label: 'conversationGenerations-generationID',
    fontFamily: theme.typography.fontFamilyMonospace,
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
    maxWidth: 0,
  }),
  spinnerWrap: css({
    label: 'conversationGenerations-spinnerWrap',
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(2),
  }),
  emptyState: css({
    label: 'conversationGenerations-emptyState',
    color: theme.colors.text.secondary,
    padding: theme.spacing(1, 0),
  }),
  statusText: css({
    label: 'conversationGenerations-statusText',
    whiteSpace: 'nowrap' as const,
  }),
});

export default function ConversationGenerations({
  generations,
  loading = false,
  errorMessage = '',
}: ConversationGenerationsProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Generations ({generations.length})</h3>
      {errorMessage.length > 0 && <Alert severity="error" title="Failed to load generations">{errorMessage}</Alert>}
      {loading ? (
        <div className={styles.spinnerWrap}>
          <Spinner aria-label="loading conversation generations" />
        </div>
      ) : generations.length === 0 ? (
        <div className={styles.emptyState}>No generations in this conversation.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr className={styles.headerRow}>
              <th className={styles.headerCell}>Generation</th>
              <th className={styles.headerCell}>Model</th>
              <th className={styles.headerCell}>Created</th>
              <th className={styles.headerCell}>Tokens</th>
              <th className={styles.headerCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {generations.map((generation) => {
              const hasError = Boolean(generation.error?.message);
              return (
                <tr
                  key={generation.generation_id}
                  className={`${styles.row} ${hasError ? styles.rowError : ''}`}
                >
                  <td className={`${styles.cell} ${styles.generationID}`}>
                    {generation.generation_id}
                  </td>
                  <td className={styles.cell}>{formatModel(generation)}</td>
                  <td className={styles.cell}>{formatTimestamp(generation.created_at)}</td>
                  <td className={styles.cell}>{formatTokenUsage(generation)}</td>
                  <td className={`${styles.cell} ${styles.statusText}`}>
                    {hasError ? <Text color="error">Error</Text> : <Text color="success">OK</Text>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
