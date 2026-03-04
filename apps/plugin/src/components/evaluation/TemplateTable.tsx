import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, IconButton, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type TemplateDefinition } from '../../evaluation/types';

export type TemplateTableProps = {
  templates: TemplateDefinition[];
  onSelect?: (templateID: string) => void;
  onDelete?: (templateID: string) => void;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  header: css({
    display: 'grid',
    gridTemplateColumns: '2fr 100px 80px 110px 3fr 100px 40px',
    gap: theme.spacing(2),
    padding: theme.spacing(0.5, 2),
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '2fr 100px 80px 110px 3fr 100px 40px',
    gap: theme.spacing(2),
    padding: theme.spacing(1.5, 2),
    alignItems: 'center',
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
    cursor: 'pointer',
    transition: 'box-shadow 0.15s ease-in-out',
    '&:hover': {
      boxShadow: theme.shadows.z2,
    },
  }),
  templateId: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  templateIcon: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: theme.shape.radius.sm,
    background: theme.isDark ? 'rgba(138, 109, 245, 0.15)' : 'rgba(138, 109, 245, 0.12)',
    color: 'rgb(138, 109, 245)',
    flexShrink: 0,
  }),
});

export default function TemplateTable({ templates, onSelect, onDelete }: TemplateTableProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.table}>
      <div className={styles.header}>
        <Text weight="medium" variant="bodySmall" color="secondary">
          Template
        </Text>
        <Text weight="medium" variant="bodySmall" color="secondary">
          Kind
        </Text>
        <Text weight="medium" variant="bodySmall" color="secondary">
          Scope
        </Text>
        <Text weight="medium" variant="bodySmall" color="secondary">
          Version
        </Text>
        <Text weight="medium" variant="bodySmall" color="secondary">
          Description
        </Text>
        <Text weight="medium" variant="bodySmall" color="secondary">
          Created
        </Text>
        <div />
      </div>
      {templates.map((template) => (
        <div
          key={template.template_id}
          className={styles.row}
          onClick={() => onSelect?.(template.template_id)}
          role="row"
        >
          <div className={styles.templateId}>
            <span className={styles.templateIcon}>
              <Icon name="document-info" size="md" />
            </span>
            <Text weight="medium" truncate>
              {template.template_id}
            </Text>
          </div>
          <div>
            <Badge text={EVALUATOR_KIND_LABELS[template.kind]} color={getKindBadgeColor(template.kind)} />
          </div>
          <div>
            <Badge text={template.scope} color={template.scope === 'global' ? 'orange' : 'blue'} />
          </div>
          <Text color="secondary" variant="bodySmall">
            {template.latest_version}
          </Text>
          <Text truncate color="secondary" variant="bodySmall">
            {template.description || '—'}
          </Text>
          <Text color="secondary" variant="bodySmall">
            {formatDate(template.created_at)}
          </Text>
          {onDelete && template.scope === 'tenant' ? (
            <IconButton
              name="trash-alt"
              tooltip="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(template.template_id);
              }}
            />
          ) : (
            <div />
          )}
        </div>
      ))}
    </div>
  );
}
