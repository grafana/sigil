import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Switch, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { SELECTOR_OPTIONS, type Evaluator, type Rule } from '../../evaluation/types';
import PipelineNode from './PipelineNode';

export type PipelineCardProps = {
  rule: Rule;
  evaluators: Evaluator[];
  onToggle?: (ruleID: string, enabled: boolean) => void;
  onClick?: (ruleID: string) => void;
};

function getMatchEntries(match: Record<string, string | string[]>): string[] {
  return Object.entries(match).map(([key, val]) => {
    const v = Array.isArray(val) ? val.join(', ') : val;
    return `${key}: ${v}`;
  });
}

function summarize(items: string[]): string {
  if (items.length === 0) {
    return '—';
  }
  if (items.length === 1) {
    return items[0];
  }
  return `${items[0]} +${items.length - 1}`;
}

function getSelectorLabel(selector: Rule['selector']): string {
  const opt = SELECTOR_OPTIONS.find((o) => o.value === selector);
  return opt?.label ?? selector;
}

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    boxShadow: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '40px 300px 2fr 20px 3fr 20px 90px 20px 2fr',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1.25, 1.25),
  }),
  ruleId: css({
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left' as const,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
  ruleName: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
  step: css({
    minWidth: 0,
    overflow: 'hidden',
  }),
  arrow: css({
    color: theme.colors.text.secondary,
    opacity: 0.6,
    justifySelf: 'center',
  }),
});

export default function PipelineCard({ rule, evaluators, onToggle, onClick }: PipelineCardProps) {
  const styles = useStyles2(getStyles);

  const selectorLabel = getSelectorLabel(rule.selector);
  const matchEntries = getMatchEntries(rule.match);
  const sampleLabel = `${Math.round(rule.sample_rate * 100)}%`;
  const evaluatorList = rule.evaluator_ids.map(
    (id) => evaluators.find((e) => e.evaluator_id === id)?.evaluator_id ?? id
  );

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

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <Switch
          value={rule.enabled}
          onChange={handleToggle}
          disabled={onToggle == null}
          aria-label={`Toggle rule ${rule.rule_id}`}
        />
        {onClick != null ? (
          <button type="button" className={styles.ruleId} onClick={handleCardClick}>
            <Text weight="medium" truncate>
              {rule.rule_id}
            </Text>
          </button>
        ) : (
          <span className={styles.ruleName}>
            <Text weight="medium" truncate>
              {rule.rule_id}
            </Text>
          </span>
        )}
        <div className={styles.step}>
          <PipelineNode kind="selector" label={selectorLabel} />
        </div>
        <Icon name="arrow-right" size="xs" className={styles.arrow} />
        <div className={styles.step}>
          {matchEntries.length > 1 ? (
            <Tooltip
              content={
                <div>
                  {matchEntries.map((entry) => (
                    <div key={entry}>{entry}</div>
                  ))}
                </div>
              }
              placement="top"
            >
              <span>
                <PipelineNode kind="match" label={summarize(matchEntries)} />
              </span>
            </Tooltip>
          ) : (
            <PipelineNode kind="match" label={summarize(matchEntries)} />
          )}
        </div>
        <Icon name="arrow-right" size="xs" className={styles.arrow} />
        <div className={styles.step}>
          <PipelineNode kind="sample" label={sampleLabel} />
        </div>
        <Icon name="arrow-right" size="xs" className={styles.arrow} />
        <div className={styles.step}>
          {evaluatorList.length > 1 ? (
            <Tooltip
              content={
                <div>
                  {evaluatorList.map((name) => (
                    <div key={name}>{name}</div>
                  ))}
                </div>
              }
              placement="top"
            >
              <span>
                <PipelineNode kind="evaluator" label={summarize(evaluatorList)} />
              </span>
            </Tooltip>
          ) : (
            <PipelineNode kind="evaluator" label={summarize(evaluatorList)} />
          )}
        </div>
      </div>
    </div>
  );
}
