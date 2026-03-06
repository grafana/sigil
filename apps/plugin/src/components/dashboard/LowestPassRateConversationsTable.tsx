import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Badge, Icon, LinkButton, Spinner, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { ConversationsDataSource } from '../../conversation/api';
import { buildConversationSearchFilter } from '../../conversation/filters';
import type { ConversationSearchResult } from '../../conversation/types';
import type { DashboardFilters } from '../../dashboard/types';
import { PLUGIN_BASE, ROUTES, buildConversationExploreRoute } from '../../constants';
import { getBreakdownStatPanelStyles, formatRelativeTime } from './dashboardShared';

const MAX_ROWS = 10;

export type LowestPassRateConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
};

function getConversationPassRate(c: ConversationSearchResult): number | null {
  if (!c.eval_summary) {
    return null;
  }
  const total = c.eval_summary.pass_count + c.eval_summary.fail_count;
  if (total === 0) {
    return null;
  }
  return c.eval_summary.pass_count / total;
}

function buildSeeMoreUrl(timeRange: TimeRange, filters: DashboardFilters): string {
  const params = new URLSearchParams();
  params.set('from', String(timeRange.raw.from));
  params.set('to', String(timeRange.raw.to));
  for (const p of filters.providers) {
    params.append('provider', p);
  }
  for (const m of filters.models) {
    params.append('model', m);
  }
  for (const a of filters.agentNames) {
    params.append('agent', a);
  }
  for (const lf of filters.labelFilters) {
    if (lf.key && lf.value) {
      params.append('label', `${lf.key}|${lf.operator}|${lf.value}`);
    }
  }
  params.set('orderBy', 'evals');
  return `${PLUGIN_BASE}/${ROUTES.Conversations}?${params.toString()}`;
}

export function LowestPassRateConversationsTable({
  conversationsDataSource,
  timeRange,
  filters,
}: LowestPassRateConversationsTableProps) {
  const styles = useStyles2(getStyles);
  const bspStyles = useStyles2(getBreakdownStatPanelStyles);
  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const versionRef = useRef(0);

  const fromISO = useMemo(() => timeRange.from.toISOString(), [timeRange.from]);
  const toISO = useMemo(() => timeRange.to.toISOString(), [timeRange.to]);
  const filterString = useMemo(() => buildConversationSearchFilter(filters), [filters]);

  useEffect(() => {
    const version = ++versionRef.current;
    setLoading(true);
    setError('');

    void (async () => {
      try {
        let cursor = '';
        let hasMore = true;
        const all: ConversationSearchResult[] = [];
        const maxPages = 5;
        let page = 0;

        while (hasMore && page < maxPages) {
          const response = await conversationsDataSource.searchConversations({
            filters: filterString,
            select: [],
            time_range: { from: fromISO, to: toISO },
            page_size: 100,
            cursor,
          });
          if (versionRef.current !== version) {
            return;
          }
          all.push(...(response.conversations ?? []));
          cursor = response.next_cursor ?? '';
          hasMore = Boolean(response.has_more && cursor.length > 0);
          page++;
        }

        const withEvals = all.filter((c) => getConversationPassRate(c) !== null);
        withEvals.sort((a, b) => (getConversationPassRate(a) ?? 0) - (getConversationPassRate(b) ?? 0));
        setConversations(withEvals.slice(0, MAX_ROWS));
      } catch (err) {
        if (versionRef.current !== version) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      } finally {
        if (versionRef.current === version) {
          setLoading(false);
        }
      }
    })();
  }, [conversationsDataSource, fromISO, toISO, filterString]);

  const title = 'Lowest pass rate conversations';
  const seeMoreHref = buildSeeMoreUrl(timeRange, filters);

  if (loading) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={bspStyles.bspCenter} style={{ padding: 32 }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error && conversations.length === 0) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={bspStyles.bspCenter} style={{ padding: 32, opacity: 0.6 }}>
          {error}
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className={styles.tablePanel}>
        <div className={styles.tablePanelHeader}>
          <span className={bspStyles.bspTitle}>{title}</span>
        </div>
        <div className={styles.emptyState}>
          <Icon name="check-circle" size="xl" />
          <Text color="secondary">No evaluated conversations in this time range.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tablePanel}>
      <div className={styles.tablePanelHeader}>
        <span className={bspStyles.bspTitle}>{title}</span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.headerCell}>Conversation</th>
            <th className={styles.headerCell}>Pass Rate</th>
            <th className={styles.headerCell}>Passed</th>
            <th className={styles.headerCell}>Failed</th>
            <th className={styles.headerCell}>Models</th>
            <th className={styles.headerCell}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map((conversation) => {
            const passRate = getConversationPassRate(conversation);
            const pct = passRate !== null ? Math.round(passRate * 100) : 0;
            return (
              <tr
                key={conversation.conversation_id}
                className={styles.tableRow}
                onClick={(e) => {
                  const href = `${PLUGIN_BASE}/${buildConversationExploreRoute(conversation.conversation_id)}`;
                  if (e.metaKey || e.ctrlKey) {
                    window.open(href, '_blank');
                  } else {
                    window.location.href = href;
                  }
                }}
                role="link"
                aria-label={`view conversation ${conversation.conversation_id}`}
              >
                <td className={`${styles.tableCell} ${styles.idCell}`}>
                  <span>{conversation.conversation_title?.trim() || conversation.conversation_id}</span>
                </td>
                <td className={styles.tableCell}>
                  <div className={styles.evalBar}>
                    <div className={styles.evalBarTrack}>
                      <div className={styles.evalBarFill} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={styles.evalBarLabel}>{pct}%</span>
                  </div>
                </td>
                <td className={styles.tableCell}>{conversation.eval_summary?.pass_count ?? 0}</td>
                <td className={styles.tableCell}>
                  {(conversation.eval_summary?.fail_count ?? 0) > 0 ? (
                    <Badge text={String(conversation.eval_summary?.fail_count)} color="red" />
                  ) : (
                    <Text color="secondary">0</Text>
                  )}
                </td>
                <td className={styles.tableCell}>
                  <div className={styles.modelList}>
                    {conversation.models.map((model) => (
                      <Badge key={model} text={model} color="blue" />
                    ))}
                    {conversation.models.length === 0 && <Text color="secondary">-</Text>}
                  </div>
                </td>
                <td className={styles.tableCell}>
                  <Tooltip content={new Date(conversation.last_generation_at).toLocaleString()} placement="left">
                    <span>{formatRelativeTime(conversation.last_generation_at)}</span>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.seeMoreFooter}>
        <LinkButton href={seeMoreHref} variant="secondary" fill="text" size="sm" icon="arrow-right">
          See more conversations
        </LinkButton>
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    tablePanel: css({
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    tablePanelHeader: css({
      padding: theme.spacing(1.5, 2),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    table: css({
      width: '100%',
      borderCollapse: 'collapse',
    }),
    headerRow: css({
      borderBottom: `2px solid ${theme.colors.border.medium}`,
    }),
    headerCell: css({
      padding: theme.spacing(1, 1.5),
      textAlign: 'left',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
    }),
    tableRow: css({
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'background 0.1s ease',
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    tableCell: css({
      padding: theme.spacing(1, 1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      verticalAlign: 'middle',
    }),
    idCell: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
    }),
    modelList: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(0.5),
    }),
    emptyState: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(4),
      color: theme.colors.text.secondary,
    }),
    seeMoreFooter: css({
      display: 'flex',
      justifyContent: 'center',
      padding: theme.spacing(1),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    evalBar: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      minWidth: 120,
    }),
    evalBarTrack: css({
      flex: 1,
      height: 6,
      borderRadius: 3,
      background: theme.colors.error.transparent,
      overflow: 'hidden',
    }),
    evalBarFill: css({
      height: '100%',
      borderRadius: 3,
      background: theme.colors.success.main,
      transition: 'width 0.2s ease',
    }),
    evalBarLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      minWidth: 36,
      textAlign: 'right',
    }),
  };
}
