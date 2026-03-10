import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Badge, Text, Tooltip, useStyles2 } from '@grafana/ui';
import DataTable, { type ColumnDef, getCommonCellStyles } from '../shared/DataTable';
import ModelChipList from '../shared/ModelChipList';
import { getConversationPassRate } from '../../conversation/aggregates';
import type { ConversationsDataSource } from '../../conversation/api';
import { buildConversationSearchFilter } from '../../conversation/filters';
import type { ConversationSearchResult } from '../../conversation/types';
import type { DashboardFilters } from '../../dashboard/types';
import { PLUGIN_BASE, ROUTES, buildConversationExploreRoute } from '../../constants';
import { formatRelativeTime } from './dashboardShared';

const MAX_ROWS = 10;

export type LowestPassRateConversationsTableProps = {
  conversationsDataSource: ConversationsDataSource;
  timeRange: TimeRange;
  filters: DashboardFilters;
};

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

  const columns: Array<ColumnDef<ConversationSearchResult>> = useMemo(
    () => [
      {
        id: 'conversation',
        header: 'Conversation',
        cell: (c: ConversationSearchResult) => (
          <span className={styles.monoCell}>{c.conversation_title?.trim() || c.conversation_id}</span>
        ),
      },
      {
        id: 'passRate',
        header: 'Pass Rate',
        cell: (c: ConversationSearchResult) => {
          const passRate = getConversationPassRate(c);
          const pct = passRate !== null ? Math.round(passRate * 100) : 0;
          return (
            <div className={styles.evalBar}>
              <div className={styles.evalBarTrack}>
                <div className={styles.evalBarFill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.evalBarLabel}>{pct}%</span>
            </div>
          );
        },
      },
      {
        id: 'passed',
        header: 'Passed',
        cell: (c: ConversationSearchResult) => c.eval_summary?.pass_count ?? 0,
      },
      {
        id: 'failed',
        header: 'Failed',
        cell: (c: ConversationSearchResult) =>
          (c.eval_summary?.fail_count ?? 0) > 0 ? (
            <Badge text={String(c.eval_summary?.fail_count)} color="red" />
          ) : (
            <Text color="secondary">0</Text>
          ),
      },
      {
        id: 'models',
        header: 'Models',
        cell: (c: ConversationSearchResult) => <ModelChipList models={c.models} />,
      },
      {
        id: 'lastActivity',
        header: 'Last activity',
        cell: (c: ConversationSearchResult) => (
          <Tooltip content={new Date(c.last_generation_at).toLocaleString()} placement="left">
            <span>{formatRelativeTime(c.last_generation_at)}</span>
          </Tooltip>
        ),
      },
    ],
    [styles.monoCell, styles.evalBar, styles.evalBarTrack, styles.evalBarFill, styles.evalBarLabel]
  );

  const handleRowClick = useCallback((c: ConversationSearchResult, e: React.MouseEvent) => {
    const href = `${PLUGIN_BASE}/${buildConversationExploreRoute(c.conversation_id)}`;
    if (e.metaKey || e.ctrlKey) {
      window.open(href, '_blank');
    } else {
      window.location.href = href;
    }
  }, []);

  return (
    <DataTable
      columns={columns}
      data={conversations}
      keyOf={(c) => c.conversation_id}
      onRowClick={handleRowClick}
      rowRole="link"
      rowAriaLabel={(c) => `view conversation ${c.conversation_id}`}
      panelTitle="Lowest pass rate conversations"
      loading={loading}
      loadError={error}
      emptyIcon="check-circle"
      emptyMessage="No evaluated conversations in this time range."
      seeMoreHref={buildSeeMoreUrl(timeRange, filters)}
      seeMoreLabel="See more conversations"
    />
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    ...getCommonCellStyles(theme),
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
      textAlign: 'right' as const,
    }),
  };
}
