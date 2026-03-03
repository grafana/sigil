import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { ConversationSearchResult } from '../../conversation/types';

export type ConversationColumnProps = {
  conversation: ConversationSearchResult;
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'conversationColumn-container',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    height: '100%',
    overflowY: 'auto' as const,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    padding: theme.spacing(0, 0.5, 0, 2),
  }),
  summary: css({
    label: 'conversationColumn-summary',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    paddingBottom: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
  }),
  summaryGrid: css({
    label: 'conversationColumn-summaryGrid',
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  }),
  summaryItem: css({
    label: 'conversationColumn-summaryItem',
    minWidth: 0,
  }),
  summaryLabel: css({
    label: 'conversationColumn-summaryLabel',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
  }),
  summaryValue: css({
    label: 'conversationColumn-summaryValue',
    fontFamily: theme.typography.fontFamilyMonospace,
    overflowWrap: 'anywhere' as const,
  }),
  bodyPlaceholder: css({
    label: 'conversationColumn-bodyPlaceholder',
    flex: 1,
    minHeight: 0,
    border: `1px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.colors.text.secondary,
    padding: theme.spacing(2),
  }),
});

export default function ConversationColumn({ conversation }: ConversationColumnProps) {
  const styles = useStyles2(getStyles);
  const ratingSummary = conversation.rating_summary;
  const models = conversation.models.length > 0 ? conversation.models.join(', ') : '-';

  return (
    <div className={styles.container}>
      <div className={styles.summary}>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Conversation ID</div>
            <div className={styles.summaryValue}>{conversation.conversation_id}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>LLM calls</div>
            <div>{conversation.generation_count}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Models</div>
            <div>{models}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Errors</div>
            <div>{conversation.error_count}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Ratings</div>
            <div>{ratingSummary ? `${ratingSummary.good_count} good / ${ratingSummary.bad_count} bad` : '-'}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>First generation</div>
            <div>{formatTimestamp(conversation.first_generation_at)}</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>Last generation</div>
            <div>{formatTimestamp(conversation.last_generation_at)}</div>
          </div>
        </div>
      </div>
      <div className={styles.bodyPlaceholder}>Conversation details panel coming soon.</div>
    </div>
  );
}
