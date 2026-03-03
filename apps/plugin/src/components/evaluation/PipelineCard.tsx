import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Switch, Text, useStyles2 } from '@grafana/ui';
import { SELECTOR_OPTIONS, type Evaluator, type Rule } from '../../evaluation/types';
import PipelineNode from './PipelineNode';

export type PipelineCardProps = {
  rule: Rule;
  evaluators: Evaluator[];
  onToggle?: (ruleID: string, enabled: boolean) => void;
  onClick?: (ruleID: string) => void;
  onDelete?: (ruleID: string) => void;
};

function formatMatchSummary(match: Record<string, string | string[]>): string {
  const entries = Object.entries(match);
  if (entries.length === 0) {
    return '—';
  }
  return entries
    .map(([key, val]) => {
      const v = Array.isArray(val) ? val.join(', ') : val;
      return `${key}: ${v}`;
    })
    .join('; ');
}

function getSelectorLabel(selector: Rule['selector']): string {
  const opt = SELECTOR_OPTIONS.find((o) => o.value === selector);
  return opt?.label ?? selector;
}

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    overflow: 'hidden',
    background: theme.colors.background.primary,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  headerLeft: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    minWidth: 0,
  }),
  ruleId: css({
    cursor: 'pointer',
  }),
  pipeline: css({
    padding: theme.spacing(1.5),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
  }),
  arrow: css({
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
});

export default function PipelineCard({ rule, evaluators, onToggle, onClick, onDelete }: PipelineCardProps) {
  const styles = useStyles2(getStyles);

  const selectorLabel = getSelectorLabel(rule.selector);
  const matchSummary = formatMatchSummary(rule.match);
  const sampleLabel = `${Math.round(rule.sample_rate * 100)}%`;
  const evaluatorLabels = rule.evaluator_ids
    .map((id) => evaluators.find((e) => e.evaluator_id === id)?.evaluator_id ?? id)
    .join(', ');

  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (onToggle != null) {
      onToggle(rule.rule_id, event.target.checked);
    }
  };

  const handleCardClick = () => {
    if (onClick != null) {
      onClick(rule.rule_id);
    }
  };

  const handleDelete = () => {
    if (onDelete != null && window.confirm(`Delete rule "${rule.rule_id}"?`)) {
      onDelete(rule.rule_id);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Switch
            value={rule.enabled}
            onChange={handleToggle}
            disabled={onToggle == null}
            aria-label={`Toggle rule ${rule.rule_id}`}
          />
          {onClick != null ? (
            <button
              type="button"
              className={styles.ruleId}
              onClick={handleCardClick}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Text weight="medium" truncate>
                {rule.rule_id}
              </Text>
            </button>
          ) : (
            <Text weight="medium" truncate>
              {rule.rule_id}
            </Text>
          )}
        </div>
        {onDelete != null && <IconButton name="trash-alt" size="md" tooltip="Delete rule" onClick={handleDelete} />}
      </div>
      <div className={styles.pipeline}>
        <PipelineNode kind="selector" label={selectorLabel} />
        <Icon name="arrow-right" size="sm" className={styles.arrow} />
        <PipelineNode kind="match" label={matchSummary} />
        <Icon name="arrow-right" size="sm" className={styles.arrow} />
        <PipelineNode kind="sample" label={sampleLabel} />
        <Icon name="arrow-right" size="sm" className={styles.arrow} />
        <PipelineNode kind="evaluator" label={evaluatorLabels} />
      </div>
    </div>
  );
}
