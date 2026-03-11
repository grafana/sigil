import React from 'react';
import { css, cx } from '@emotion/css';
import { Badge, useStyles2 } from '@grafana/ui';

export type ActorBadgeProps = {
  actor?: string;
  className?: string;
};

function actorLabel(actor?: string): string {
  const trimmed = (actor ?? '').trim();
  return trimmed.length > 0 ? trimmed : '—';
}

const getStyles = () => ({
  badge: css({
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: '100%',
  }),
});

export default function ActorBadge({ actor, className }: ActorBadgeProps) {
  const styles = useStyles2(getStyles);

  return (
    <span className={cx(styles.badge, className)}>
      <Badge text={actorLabel(actor)} color="darkgrey" />
    </span>
  );
}
