import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { type ConversationOrderBy, type DashboardFilters, conversationOrderByLabel } from '../../dashboard/types';
import { buildConversationsUrl } from '../../dashboard/url';

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
