import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, IconButton, Text, useStyles2 } from '@grafana/ui';
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
    gap: 0,
  }),
  header: css({
    display: 'grid',
    gridTemplateColumns: '2fr 100px 80px 120px 3fr 120px 40px',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '2fr 100px 80px 120px 3fr 120px 40px',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
});

export default function TemplateTable({ templates, onSelect, onDelete }: TemplateTableProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.table}>
      <div className={styles.header}>
        <Text weight="medium" variant="bodySmall">
          Template ID
        </Text>
        <Text weight="medium" variant="bodySmall">
          Kind
        </Text>
        <Text weight="medium" variant="bodySmall">
          Scope
        </Text>
        <Text weight="medium" variant="bodySmall">
          Latest Version
        </Text>
        <Text weight="medium" variant="bodySmall">
          Description
        </Text>
        <Text weight="medium" variant="bodySmall">
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
          <Text truncate>{template.template_id}</Text>
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
