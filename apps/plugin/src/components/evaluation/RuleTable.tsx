import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Switch, Text, Tooltip, useStyles2 } from '@grafana/ui';
import {
  formatEvaluatorId,
  getKindBadgeColor,
  SELECTOR_OPTIONS,
  type Evaluator,
  type Rule,
} from '../../evaluation/types';

export type RuleTableProps = {
  rules: Rule[];
  evaluators: Evaluator[];
  onToggle?: (ruleID: string, enabled: boolean) => void;
  onClick?: (ruleID: string) => void;
  showToggle?: boolean;
};

function getSelectorLabel(selector: Rule['selector']): string {
  const opt = SELECTOR_OPTIONS.find((o) => o.value === selector);
  return opt?.label ?? selector;
}

function formatMatchEntries(match: Record<string, string | string[]>): string[] {
  return Object.entries(match).map(([key, val]) => {
    const v = Array.isArray(val) ? val.join(', ') : val;
    return `${key}: ${v}`;
  });
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
  }),
  header: css({
    display: 'grid',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  ruleId: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  matchCell: css({
    minWidth: 0,
    overflow: 'hidden',
  }),
  evaluators: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
});

export default function RuleTable({ rules, evaluators, onToggle, onClick, showToggle = true }: RuleTableProps) {
  const styles = useStyles2(getStyles);
  const gridTemplateColumns = showToggle ? '48px 2fr 140px 2fr 80px 2fr' : '2fr 140px 2fr 80px 2fr';

  return (
    <div className={styles.table}>
      <div className={styles.header} style={{ gridTemplateColumns }}>
        {showToggle && (
          <Text weight="medium" variant="bodySmall">
            On
          </Text>
        )}
        <Text weight="medium" variant="bodySmall">
          Rule ID
        </Text>
        <Text weight="medium" variant="bodySmall">
          Selector
        </Text>
        <Text weight="medium" variant="bodySmall">
          Match
        </Text>
        <Text weight="medium" variant="bodySmall">
          Sample
        </Text>
        <Text weight="medium" variant="bodySmall">
          Evaluators
        </Text>
      </div>
      {rules.map((rule) => {
        const matchEntries = formatMatchEntries(rule.match);
        const matchDisplay = matchEntries.length === 0 ? '—' : matchEntries[0];
        const evalEntries = rule.evaluator_ids.map((id) => {
          const evaluator = evaluators.find((e) => e.evaluator_id === id);
          return {
            name: evaluator ? formatEvaluatorId(evaluator.evaluator_id) : id,
            color: evaluator ? getKindBadgeColor(evaluator.kind) : ('blue' as const),
          };
        });

        return (
          <div
            key={rule.rule_id}
            className={styles.row}
            style={{ gridTemplateColumns }}
            onClick={() => onClick?.(rule.rule_id)}
            role="row"
          >
            {showToggle && (
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  value={rule.enabled}
                  onChange={(e) => onToggle?.(rule.rule_id, e.currentTarget.checked)}
                  disabled={onToggle == null}
                  aria-label={`Toggle rule ${rule.rule_id}`}
                />
              </div>
            )}
            <div className={styles.ruleId}>
              <Text weight="medium" truncate>
                {rule.rule_id}
              </Text>
            </div>
            <div>
              <Badge text={getSelectorLabel(rule.selector)} color="green" />
            </div>
            <div className={styles.matchCell}>
              {matchEntries.length <= 1 ? (
                <Text color="secondary" variant="bodySmall" truncate>
                  {matchDisplay}
                </Text>
              ) : (
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
                    <Text color="secondary" variant="bodySmall">
                      {matchDisplay}{' '}
                    </Text>
                    <Badge text={`+${matchEntries.length - 1}`} color="blue" />
                  </span>
                </Tooltip>
              )}
            </div>
            <Text color="secondary" variant="bodySmall">
              {Math.round(rule.sample_rate * 100)}%
            </Text>
            <div className={styles.evaluators}>
              {evalEntries.map((entry) => (
                <Badge key={entry.name} text={entry.name} color={entry.color} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
