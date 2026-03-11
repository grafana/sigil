import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../../constants';
import { type ConversationOrderBy, type DashboardFilters, conversationOrderByLabel } from '../../dashboard/types';

export function buildConversationsUrl(
  timeRange: TimeRange,
  filters: DashboardFilters,
  orderBy: ConversationOrderBy
): string {
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
  if (orderBy !== 'time') {
    params.set('orderBy', orderBy);
  }
  return `${PLUGIN_BASE}/${ROUTES.Conversations}?${params.toString()}`;
}

type ViewConversationsLinkProps = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  orderBy: ConversationOrderBy;
};

export function ViewConversationsLink({ timeRange, filters, orderBy }: ViewConversationsLinkProps) {
  const styles = useStyles2(getStyles);
  const href = buildConversationsUrl(timeRange, filters, orderBy);
  const label =
    orderBy === 'time' ? 'View conversations' : `View conversations · Order by: ${conversationOrderByLabel[orderBy]}`;
  return (
    <Tooltip content={label}>
      <a href={href} className={styles.link} aria-label={label}>
        <Icon name={'align-left' as any} size="md" />
      </a>
    </Tooltip>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    link: css({
      color: theme.colors.text.secondary,
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
  };
}
