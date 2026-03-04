import React, { useCallback, useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import { type GrafanaTheme2, type SelectableValue } from '@grafana/data';
import { Icon, IconButton, Select, useStyles2 } from '@grafana/ui';
import { type FilterOperator, filterOperatorLabel, FILTER_OPERATORS, type LabelFilter } from '../../dashboard/types';
import type { DashboardDataSource } from '../../dashboard/api';
import { useLabelValues } from '../dashboard/useLabelValues';

export type LabelFilterInputProps = {
  filters: LabelFilter[];
  labelKeyOptions: Array<SelectableValue<string>>;
  labelsLoading: boolean;
  dataSource: DashboardDataSource;
  from: number;
  to: number;
  onChange: (index: number, filter: LabelFilter) => void;
  onRemove: (index: number) => void;
};

const operatorOptions: Array<SelectableValue<FilterOperator>> = FILTER_OPERATORS.map((op) => ({
  label: op,
  value: op,
  description: filterOperatorLabel[op],
}));

type EditingSegment = 'key' | 'operator' | 'value';

type EditingState = {
  index: number;
  segment: EditingSegment;
} | null;

function CompletedPill({
  filter,
  index,
  onEdit,
  onRemove,
}: {
  filter: LabelFilter;
  index: number;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const styles = useStyles2(getPillStyles);
  const label = `${filter.key} ${filter.operator} ${filter.value}`;
  return (
    <span className={styles.pill}>
      <button
        type="button"
        className={styles.pillLabel}
        onClick={() => onEdit(index)}
        aria-label={`Edit filter ${label}`}
        title={label}
      >
        {label}
      </button>
      <IconButton
        className={styles.pillRemove}
        name="times"
        aria-label={`Remove filter ${label}`}
        size="sm"
        onClick={() => onRemove(index)}
      />
    </span>
  );
}

function WipInput({
  filter,
  index,
  editingSegment,
  autoFocus = false,
  labelKeyOptions,
  labelsLoading,
  dataSource,
  from,
  to,
  onChange,
  onRemove,
  onDone,
}: {
  filter: LabelFilter;
  index: number;
  editingSegment: EditingSegment;
  autoFocus?: boolean;
  labelKeyOptions: Array<SelectableValue<string>>;
  labelsLoading: boolean;
  dataSource: DashboardDataSource;
  from: number;
  to: number;
  onChange: (index: number, filter: LabelFilter) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  const styles = useStyles2(getWipStyles);
  const { values: valueOptions, loading: valuesLoading } = useLabelValues(dataSource, filter.key, from, to);
  const valueSelectOptions = useMemo(() => valueOptions.map((v) => ({ label: v, value: v })), [valueOptions]);

  const [segment, setSegment] = useState<EditingSegment>(editingSegment);

  const handleKeyChange = useCallback(
    (sel: SelectableValue<string>) => {
      onChange(index, { key: sel?.value ?? '', operator: filter.operator, value: '' });
      if (sel?.value) {
        setSegment('operator');
      }
    },
    [index, filter.operator, onChange]
  );

  const handleOperatorChange = useCallback(
    (sel: SelectableValue<FilterOperator>) => {
      onChange(index, { ...filter, operator: sel?.value ?? '=' });
      setSegment('value');
    },
    [index, filter, onChange]
  );

  const handleValueChange = useCallback(
    (sel: SelectableValue<string>) => {
      onChange(index, { ...filter, value: sel?.value ?? '' });
      onDone();
    },
    [index, filter, onChange, onDone]
  );

  const showKeyPill = filter.key && segment !== 'key';
  const showOperatorPill = filter.key && filter.operator && segment !== 'operator';

  return (
    <span className={styles.wip}>
      {showKeyPill && (
        <button type="button" className={cx(styles.segmentPill, styles.keySegment)} onClick={() => setSegment('key')}>
          {filter.key}
        </button>
      )}

      {segment === 'key' && (
        <Select<string>
          className={styles.inlineSelect}
          options={labelKeyOptions}
          value={filter.key || null}
          onChange={handleKeyChange}
          placeholder="Filter by label values"
          isLoading={labelsLoading}
          isSearchable
          allowCustomValue
          autoFocus={autoFocus}
          openMenuOnFocus={autoFocus}
          width={35}
          onBlur={() => {
            if (filter.key) {
              setSegment('operator');
            }
          }}
        />
      )}

      {showOperatorPill && (
        <button
          type="button"
          className={cx(styles.segmentPill, styles.operatorSegment)}
          onClick={() => setSegment('operator')}
        >
          {filter.operator}
        </button>
      )}

      {segment === 'operator' && filter.key && (
        <Select<FilterOperator>
          className={styles.inlineSelect}
          options={operatorOptions}
          value={filter.operator}
          onChange={handleOperatorChange}
          autoFocus
          openMenuOnFocus
          width="auto"
          onBlur={() => setSegment('value')}
        />
      )}

      {segment === 'value' && filter.key && (
        <Select<string>
          className={styles.inlineSelect}
          options={valueSelectOptions}
          value={filter.value || null}
          onChange={handleValueChange}
          placeholder="value"
          isLoading={valuesLoading}
          isSearchable
          allowCustomValue
          autoFocus
          openMenuOnFocus
          width={16}
          onBlur={() => {
            if (filter.value) {
              onDone();
            }
          }}
        />
      )}

      {(filter.key || filter.value) && (
        <IconButton
          className={styles.removeBtn}
          name="times"
          aria-label="Remove filter"
          size="sm"
          onClick={() => onRemove(index)}
        />
      )}
    </span>
  );
}

export function LabelFilterInput({
  filters,
  labelKeyOptions,
  labelsLoading,
  dataSource,
  from,
  to,
  onChange,
  onRemove,
}: LabelFilterInputProps) {
  const styles = useStyles2(getContainerStyles);
  const [editing, setEditing] = useState<EditingState>(null);

  const completedFilters = filters.filter((lf) => lf.key && lf.value);
  const wipFilter = filters.find((lf) => !lf.key || !lf.value);
  const wipIndex = wipFilter ? filters.indexOf(wipFilter) : filters.length;

  const handleEdit = useCallback((index: number) => {
    setEditing({ index, segment: 'key' });
  }, []);

  const handleDone = useCallback(() => {
    setEditing(null);
  }, []);

  return (
    <div className={styles.container}>
      <Icon name="filter" className={styles.filterIcon} />
      {completedFilters.map((lf) => {
        const realIndex = filters.indexOf(lf);
        if (editing && editing.index === realIndex) {
          return (
            <WipInput
              key={realIndex}
              filter={lf}
              index={realIndex}
              editingSegment={editing.segment}
              autoFocus
              labelKeyOptions={labelKeyOptions}
              labelsLoading={labelsLoading}
              dataSource={dataSource}
              from={from}
              to={to}
              onChange={onChange}
              onRemove={(i) => {
                onRemove(i);
                setEditing(null);
              }}
              onDone={handleDone}
            />
          );
        }
        return <CompletedPill key={realIndex} filter={lf} index={realIndex} onEdit={handleEdit} onRemove={onRemove} />;
      })}
      {wipFilter && !editing && (
        <WipInput
          key={wipIndex}
          filter={wipFilter}
          index={wipIndex}
          editingSegment="key"
          labelKeyOptions={labelKeyOptions}
          labelsLoading={labelsLoading}
          dataSource={dataSource}
          from={from}
          to={to}
          onChange={onChange}
          onRemove={onRemove}
          onDone={handleDone}
        />
      )}
      {!wipFilter && !editing && (
        <WipInput
          key={filters.length}
          filter={{ key: '', operator: '=', value: '' }}
          index={filters.length}
          editingSegment="key"
          labelKeyOptions={labelKeyOptions}
          labelsLoading={labelsLoading}
          dataSource={dataSource}
          from={from}
          to={to}
          onChange={onChange}
          onRemove={onRemove}
          onDone={handleDone}
        />
      )}
    </div>
  );
}

function getContainerStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'inline-flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing(0.5),
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      minHeight: 32,
      padding: theme.spacing(0, 0, 0, 0.5),
    }),
    filterIcon: css({
      color: theme.colors.text.secondary,
      marginLeft: theme.spacing(0.5),
      flexShrink: 0,
    }),
  };
}

function getPillStyles(theme: GrafanaTheme2) {
  return {
    pill: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      background: theme.colors.action.disabledBackground,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(0, 0.25, 0, 1),
      maxWidth: 240,
      minHeight: 24,
      ...theme.typography.bodySmall,
    }),
    pillLabel: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.primary,
      cursor: 'pointer',
      padding: 0,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      ...theme.typography.bodySmall,
      '&:hover': {
        textDecoration: 'underline',
      },
    }),
    pillRemove: css({
      color: theme.colors.text.secondary,
      flexShrink: 0,
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
  };
}

function getWipStyles(theme: GrafanaTheme2) {
  return {
    wip: css({
      display: 'inline-flex',
      alignItems: 'center',
      flexWrap: 'nowrap',
    }),
    segmentPill: css({
      display: 'inline-flex',
      alignItems: 'center',
      background: theme.colors.action.disabledBackground,
      border: 'none',
      padding: theme.spacing(0, 1),
      minHeight: 24,
      cursor: 'pointer',
      ...theme.typography.bodySmall,
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    keySegment: css({
      fontWeight: theme.typography.fontWeightBold,
      borderRadius: `${theme.shape.radius.default} 0 0 ${theme.shape.radius.default}`,
    }),
    operatorSegment: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      borderRadius: 0,
    }),
    inlineSelect: css({
      // Remove Select's built-in border to avoid double border with container
      '& > div': {
        border: 'none',
        background: 'transparent',
        minHeight: 28,
        boxShadow: 'none',
        outline: 'none',
      },
      '& > div > div:first-of-type': {
        border: 'none',
        boxShadow: 'none',
      },
    }),
    removeBtn: css({
      color: theme.colors.text.secondary,
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
  };
}
