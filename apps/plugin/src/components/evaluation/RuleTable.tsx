import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Switch, Text, Tooltip, useStyles2 } from '@grafana/ui';
import DataTable, { type ColumnDef } from '../shared/DataTable';
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

  const columns = useMemo<Array<ColumnDef<Rule>>>(() => {
    const cols: Array<ColumnDef<Rule>> = [];

    if (showToggle) {
      cols.push({
        id: 'on',
        header: 'On',
        cell: (rule: Rule) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              value={rule.enabled}
              onChange={(e) => onToggle?.(rule.rule_id, e.currentTarget.checked)}
              disabled={onToggle == null}
              aria-label={`Toggle rule ${rule.rule_id}`}
            />
          </div>
        ),
      });
    }

    cols.push({
      id: 'ruleId',
      header: 'Rule ID',
      cell: (rule: Rule) => (
        <div className={styles.ruleId}>
          <Text weight="medium" truncate>
            {rule.rule_id}
          </Text>
        </div>
      ),
    });

    cols.push({
      id: 'selector',
      header: 'Selector',
      width: 150,
      cell: (rule: Rule) => <Badge text={getSelectorLabel(rule.selector)} color="green" />,
    });

    cols.push({
      id: 'match',
      header: 'Match',
      cell: (rule: Rule) => {
        const matchEntries = formatMatchEntries(rule.match);
        const matchDisplay = matchEntries.length === 0 ? '—' : matchEntries[0];
        if (matchEntries.length <= 1) {
          return (
            <div className={styles.matchCell}>
              <Text color="secondary" variant="bodySmall" truncate>
                {matchDisplay}
              </Text>
            </div>
          );
        }
        return (
          <div className={styles.matchCell}>
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
          </div>
        );
      },
    });

    cols.push({
      id: 'sample',
      header: 'Sample',
      cell: (rule: Rule) => (
        <Text color="secondary" variant="bodySmall">
          {Math.round(rule.sample_rate * 100)}%
        </Text>
      ),
    });

    cols.push({
      id: 'evaluators',
      header: 'Evaluators',
      cell: (rule: Rule) => {
        const evalEntries = rule.evaluator_ids.map((id) => {
          const evaluator = evaluators.find((e) => e.evaluator_id === id);
          return {
            name: evaluator ? formatEvaluatorId(evaluator.evaluator_id) : id,
            color: evaluator ? getKindBadgeColor(evaluator.kind) : ('blue' as const),
          };
        });
        return (
          <div className={styles.evaluators}>
            {evalEntries.map((entry) => (
              <Badge key={entry.name} text={entry.name} color={entry.color} />
            ))}
          </div>
        );
      },
    });

    return cols;
  }, [showToggle, onToggle, evaluators, styles.ruleId, styles.matchCell, styles.evaluators]);

  return (
    <DataTable<Rule>
      columns={columns}
      data={rules}
      keyOf={(r) => r.rule_id}
      onRowClick={onClick ? (rule) => onClick(rule.rule_id) : undefined}
    />
  );
}
