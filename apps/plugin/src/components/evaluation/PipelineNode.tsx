import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Stack, Text, useStyles2, type IconName } from '@grafana/ui';

export type PipelineNodeKind = 'selector' | 'match' | 'sample' | 'evaluator';

export type PipelineNodeProps = {
  kind: PipelineNodeKind;
  label: string;
  detail?: string;
  onClick?: () => void;
};

const KIND_ICONS: Record<PipelineNodeKind, IconName> = {
  selector: 'filter',
  match: 'search',
  sample: 'percentage',
  evaluator: 'check-circle',
};

const getStyles = (theme: GrafanaTheme2) => ({
  node: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
  }),
  nodeClickable: css({
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
    },
  }),
  detail: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export default function PipelineNode({ kind, label, detail, onClick }: PipelineNodeProps) {
  const styles = useStyles2(getStyles);
  const iconName = KIND_ICONS[kind];
  const isClickable = onClick != null;

  const content = (
    <Stack direction="row" gap={0.5} alignItems="center">
      <Icon name={iconName} size="sm" />
      <Text variant="body" weight="medium">
        {label}
      </Text>
      {detail != null && detail.length > 0 && <span className={styles.detail}>{detail}</span>}
    </Stack>
  );

  if (isClickable) {
    return (
      <button type="button" className={cx(styles.node, styles.nodeClickable)} onClick={onClick} aria-label={label}>
        {content}
      </button>
    );
  }

  return <span className={styles.node}>{content}</span>;
}
