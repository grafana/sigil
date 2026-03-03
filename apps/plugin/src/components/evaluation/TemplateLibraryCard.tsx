import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Stack, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type TemplateDefinition } from '../../evaluation/types';

export type TemplateLibraryCardProps = {
  template: TemplateDefinition;
  onFork?: (templateID: string) => void;
  onView?: (templateID: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    padding: theme.spacing(2),
    background: theme.colors.background.secondary,
    minHeight: '180px',
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  header: css({
    marginBottom: theme.spacing(1),
  }),
  description: css({
    flex: 1,
    marginBottom: theme.spacing(2),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical' as const,
  }),
  footer: css({
    marginTop: 'auto',
  }),
});

export default function TemplateLibraryCard({ template, onFork, onView }: TemplateLibraryCardProps) {
  const styles = useStyles2(getStyles);

  const firstOutputKey = template.output_keys?.[0];
  const outputTypeLabel = firstOutputKey ? firstOutputKey.type : '';

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
          <Text weight="medium">{template.template_id}</Text>
          <Badge text={EVALUATOR_KIND_LABELS[template.kind]} color={getKindBadgeColor(template.kind)} />
          <Badge text={template.scope} color={template.scope === 'global' ? 'orange' : 'blue'} />
          {outputTypeLabel && <Badge text={outputTypeLabel} color="blue" />}
        </Stack>
      </div>
      {template.description && (
        <div className={styles.description}>
          <Text color="secondary" variant="bodySmall">
            {template.description}
          </Text>
        </div>
      )}
      <div className={styles.footer}>
        <Stack direction="row" gap={1}>
          {onFork && (
            <Button variant="secondary" size="sm" icon="code-branch" onClick={() => onFork(template.template_id)}>
              Fork
            </Button>
          )}
          {onView && (
            <Button variant="secondary" size="sm" onClick={() => onView(template.template_id)}>
              View
            </Button>
          )}
        </Stack>
      </div>
    </div>
  );
}
