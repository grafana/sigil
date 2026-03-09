import React, { useCallback, useMemo } from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Input, Select, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import {
  QueryBuilder,
  type ActionProps,
  type CombinatorSelectorProps,
  type OperatorSelectorProps,
  type ValueEditorProps,
} from 'react-querybuilder';
import {
  HEURISTIC_MAX_DEPTH,
  HEURISTIC_MAX_NODES,
  type HeuristicOperator,
  type HeuristicRuleType,
} from '../../evaluation/types';
import {
  HEURISTIC_QUERY_COMBINATORS,
  HEURISTIC_QUERY_FIELDS,
  HEURISTIC_QUERY_OPERATORS,
  type HeuristicQueryGroup,
} from '../../evaluation/heuristicConfig';

type HeuristicRuleBuilderProps = {
  query: HeuristicQueryGroup;
  onChange: (next: HeuristicQueryGroup) => void;
  error?: string;
};

type HeuristicBuilderContext = {
  totalNodes: number;
};

const HEURISTIC_CONTROL_ELEMENTS = {
  fieldSelector: null,
  combinatorSelector: HeuristicCombinatorSelector,
  operatorSelector: HeuristicOperatorSelector,
  valueEditor: HeuristicValueEditor,
  addRuleAction: HeuristicActionButton,
  addGroupAction: HeuristicActionButton,
  removeRuleAction: HeuristicActionButton,
  removeGroupAction: HeuristicActionButton,
} as const;

const getDefaultHeuristicField = () => 'response';
const getDefaultHeuristicOperator = () => 'not_empty';
const getHeuristicValueEditorType = (_field: string, operator: string) => (operator === 'not_empty' ? null : 'text');

function countQueryNodes(group: HeuristicQueryGroup): number {
  return 1 + group.rules.reduce((sum, child) => sum + ('rules' in child ? countQueryNodes(child) : 1), 0);
}

const getStyles = (theme: GrafanaTheme2) => ({
  builder: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    '& .queryBuilder': {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1),
    },
    '& .ruleGroup': {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1),
    },
    '& .queryBuilder > .ruleGroup': {
      gap: theme.spacing(1.25),
    },
    '& .ruleGroup-body': {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1),
      paddingLeft: theme.spacing(1.5),
      borderLeft: `2px solid ${theme.colors.border.weak}`,
    },
    '& .ruleGroup-header': {
      display: 'flex',
      flexWrap: 'wrap' as const,
      alignItems: 'center',
      gap: theme.spacing(1),
    },
    '& .rule': {
      display: 'flex',
      flexWrap: 'wrap' as const,
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(0.75),
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
    },
  }),
  helper: css({
    color: theme.colors.text.secondary,
  }),
  selector: css({
    width: '100% !important',
    maxWidth: 260,
    minWidth: 180,
  }),
  numeric: css({
    width: '100% !important',
    maxWidth: 140,
    minWidth: 120,
  }),
  text: css({
    width: '100% !important',
    maxWidth: 320,
    minWidth: 180,
  }),
  action: css({
    whiteSpace: 'nowrap' as const,
  }),
  error: css({
    marginBottom: theme.spacing(0.5),
  }),
});

export default function HeuristicRuleBuilder({ query, onChange, error }: HeuristicRuleBuilderProps) {
  const styles = useStyles2(getStyles);
  const controlElements = useMemo(() => HEURISTIC_CONTROL_ELEMENTS, []);
  const handleQueryChange = useCallback((next: unknown) => onChange(next as HeuristicQueryGroup), [onChange]);
  const builderContext = useMemo<HeuristicBuilderContext>(
    () => ({ totalNodes: countQueryNodes(query) }),
    [query]
  );

  return (
    <div className={styles.builder}>
      <Text variant="body" color="secondary">
        Max depth {HEURISTIC_MAX_DEPTH}, max nodes {HEURISTIC_MAX_NODES}.
      </Text>
      {error && (
        <div className={styles.error}>
          <Text variant="bodySmall" color="error">
            {error}
          </Text>
        </div>
      )}
      <QueryBuilder
        query={query}
        onQueryChange={handleQueryChange}
        fields={HEURISTIC_QUERY_FIELDS}
        operators={[...HEURISTIC_QUERY_OPERATORS]}
        combinators={[...HEURISTIC_QUERY_COMBINATORS]}
        controlElements={controlElements}
        getDefaultField={getDefaultHeuristicField}
        getDefaultOperator={getDefaultHeuristicOperator}
        getValueEditorType={getHeuristicValueEditorType}
        showShiftActions={false}
        showCloneButtons={false}
        showLockButtons={false}
        showNotToggle={false}
        addRuleToNewGroups
        context={builderContext}
      />
      <div className={styles.helper}>
        <Text variant="bodySmall">
          Use “All of” when every child rule must pass. Use “Any of” when one passing child is enough.
        </Text>
      </div>
    </div>
  );
}

function HeuristicCombinatorSelector(props: CombinatorSelectorProps) {
  const styles = useStyles2(getStyles);
  const options = HEURISTIC_QUERY_COMBINATORS.map((option) => ({
    label: option.label,
    value: option.name,
  }));
  return (
    <Select<HeuristicOperator>
      className={styles.selector}
      value={options.find((option) => option.value === props.value)}
      options={options}
      onChange={(next) => {
        if (next?.value != null) {
          props.handleOnChange(next.value);
        }
      }}
    />
  );
}

function HeuristicOperatorSelector(props: OperatorSelectorProps) {
  const styles = useStyles2(getStyles);
  const options = HEURISTIC_QUERY_OPERATORS.map((option) => ({
    label: option.label,
    value: option.name,
  }));
  return (
    <Select<HeuristicRuleType>
      className={styles.selector}
      value={options.find((option) => option.value === props.value)}
      options={options}
      onChange={(next) => {
        if (next?.value != null) {
          props.handleOnChange(next.value);
        }
      }}
    />
  );
}

function HeuristicValueEditor(props: ValueEditorProps) {
  const styles = useStyles2(getStyles);
  if (props.operator === 'not_empty') {
    return null;
  }

  const isNumeric = props.operator === 'min_length' || props.operator === 'max_length';
  return (
    <Input
      className={isNumeric ? styles.numeric : styles.text}
      type={isNumeric ? 'number' : 'text'}
      value={props.value ?? ''}
      placeholder={props.operator === 'contains' || props.operator === 'not_contains' ? 'e.g. refund' : '0'}
      onChange={(event) => props.handleOnChange(event.currentTarget.value)}
    />
  );
}

function HeuristicActionButton(props: ActionProps) {
  const styles = useStyles2(getStyles);
  const builderContext = props.context as HeuristicBuilderContext | undefined;
  const hasReachedMaxNodes = (builderContext?.totalNodes ?? 0) >= HEURISTIC_MAX_NODES;
  const label = String(props.label ?? 'Action');
  const isAddGroupAction = String(props.label ?? '').includes('Group');
  const isAddRuleAction = String(props.label ?? '').includes('Rule');
  const isRemoveAction = label === '⨯';
  const nextGroupDepth = props.level + 2;
  const exceedsMaxDepth = isAddGroupAction && nextGroupDepth > HEURISTIC_MAX_DEPTH;
  const disableForAddLimits = (isAddGroupAction || isAddRuleAction) && (hasReachedMaxNodes || exceedsMaxDepth);
  const disabled = props.disabled || disableForAddLimits;

  if (isRemoveAction) {
    return (
      <IconButton
        name="trash-alt"
        tooltip="Remove"
        aria-label="Remove rule"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            props.handleOnClick();
          }
        }}
      />
    );
  }

  return (
    <Button
      className={styles.action}
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          props.handleOnClick();
        }
      }}
    >
      {label}
    </Button>
  );
}
