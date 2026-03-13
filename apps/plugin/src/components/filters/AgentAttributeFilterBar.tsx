import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { type GrafanaTheme2, type SelectableValue } from '@grafana/data';
import { Icon, IconButton, Select, useStyles2 } from '@grafana/ui';
import type { AgentAttributeFilter } from '../../agents/types';

const AGENT_ATTRIBUTE_OPERATORS: AgentAttributeFilter['operator'][] = ['=', '!=', '=~'];

const operatorDescriptions: Record<AgentAttributeFilter['operator'], string> = {
  '=': 'Equals',
  '!=': 'Not equal',
  '=~': 'Matches regex',
};

const operatorOptions: Array<SelectableValue<AgentAttributeFilter['operator']>> = AGENT_ATTRIBUTE_OPERATORS.map((op) => ({
  label: op,
  value: op,
  description: operatorDescriptions[op],
}));

type EditingSegment = 'key' | 'operator' | 'value';

type EditingState = {
  index: number;
  segment: EditingSegment;
} | null;

type AgentAttributeFilterBarProps = {
  filters: AgentAttributeFilter[];
  tagOptions: Array<SelectableValue<string>>;
  tagsLoading: boolean;
  loadTagValues: (tag: string) => Promise<string[]>;
  onChange: (filters: AgentAttributeFilter[]) => void;
};

type AsyncValuesResult = {
  values: string[];
  loading: boolean;
};

function useAsyncTagValues(loadTagValues: (tag: string) => Promise<string[]>, tag: string): AsyncValuesResult {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const versionRef = useRef(0);

  useEffect(() => {
    const trimmedTag = tag.trim();
    if (trimmedTag.length === 0) {
      setValues([]);
      setLoading(false);
      return;
    }

    const version = ++versionRef.current;
    setLoading(true);
    void loadTagValues(trimmedTag)
      .then((nextValues) => {
        if (versionRef.current === version) {
          setValues(nextValues);
        }
      })
      .catch(() => {
        if (versionRef.current === version) {
          setValues([]);
        }
      })
      .finally(() => {
        if (versionRef.current === version) {
          setLoading(false);
        }
      });
  }, [loadTagValues, tag]);

  return { values, loading };
}

function CompletedPill({
  filter,
  index,
  onEdit,
  onRemove,
}: {
  filter: AgentAttributeFilter;
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
  tagOptions,
  tagsLoading,
  loadTagValues,
  onChange,
  onRemove,
  onDone,
}: {
  filter: AgentAttributeFilter;
  index: number;
  editingSegment: EditingSegment;
  autoFocus?: boolean;
  tagOptions: Array<SelectableValue<string>>;
  tagsLoading: boolean;
  loadTagValues: (tag: string) => Promise<string[]>;
  onChange: (index: number, filter: AgentAttributeFilter) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  const styles = useStyles2(getWipStyles);
  const { values: valueOptions, loading: valuesLoading } = useAsyncTagValues(loadTagValues, filter.key);
  const valueSelectOptions = useMemo(() => valueOptions.map((value) => ({ label: value, value })), [valueOptions]);

  const [segment, setSegment] = useState<EditingSegment>(editingSegment);

  const handleKeyChange = useCallback(
    (selection: SelectableValue<string>) => {
      onChange(index, { key: selection.value ?? '', operator: filter.operator, value: '' });
      if (selection.value) {
        setSegment('operator');
      }
    },
    [filter.operator, index, onChange]
  );

  const handleOperatorChange = useCallback(
    (selection: SelectableValue<AgentAttributeFilter['operator']>) => {
      onChange(index, { ...filter, operator: selection.value ?? '=' });
      setSegment('value');
    },
    [filter, index, onChange]
  );

  const handleValueChange = useCallback(
    (selection: SelectableValue<string>) => {
      onChange(index, { ...filter, value: selection.value ?? '' });
      onDone();
    },
    [filter, index, onChange, onDone]
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
          options={tagOptions}
          value={filter.key || null}
          onChange={handleKeyChange}
          placeholder="Filter by resource and span attributes"
          isLoading={tagsLoading}
          isSearchable
          allowCustomValue
          autoFocus={autoFocus}
          openMenuOnFocus={autoFocus}
          width={38}
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
        <Select<AgentAttributeFilter['operator']>
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
          width={18}
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

export function AgentAttributeFilterBar({
  filters,
  tagOptions,
  tagsLoading,
  loadTagValues,
  onChange,
}: AgentAttributeFilterBarProps) {
  const styles = useStyles2(getContainerStyles);
  const [editing, setEditing] = useState<EditingState>(null);

  const completedFilters = filters.filter((filter) => filter.key && filter.value);
  const wipFilter = filters.find((filter) => !filter.key || !filter.value);
  const wipIndex = wipFilter ? filters.indexOf(wipFilter) : filters.length;

  const handleEdit = useCallback((index: number) => {
    setEditing({ index, segment: 'key' });
  }, []);

  const handleDone = useCallback(() => {
    setEditing(null);
  }, []);

  const handleChange = useCallback(
    (index: number, updated: AgentAttributeFilter) => {
      const next = [...filters];
      if (index >= next.length) {
        next.push(updated);
      } else {
        next[index] = updated;
      }
      onChange(next);
    },
    [filters, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(filters.filter((_, currentIndex) => currentIndex !== index));
      setEditing(null);
    },
    [filters, onChange]
  );

  return (
    <div className={styles.container}>
      <Icon name="filter" className={styles.filterIcon} />
      {completedFilters.map((filter) => {
        const realIndex = filters.indexOf(filter);
        if (editing && editing.index === realIndex) {
          return (
            <WipInput
              key={realIndex}
              filter={filter}
              index={realIndex}
              editingSegment={editing.segment}
              autoFocus
              tagOptions={tagOptions}
              tagsLoading={tagsLoading}
              loadTagValues={loadTagValues}
              onChange={handleChange}
              onRemove={handleRemove}
              onDone={handleDone}
            />
          );
        }
        return <CompletedPill key={realIndex} filter={filter} index={realIndex} onEdit={handleEdit} onRemove={handleRemove} />;
      })}
      {wipFilter && !editing && (
        <WipInput
          key={wipIndex}
          filter={wipFilter}
          index={wipIndex}
          editingSegment="key"
          tagOptions={tagOptions}
          tagsLoading={tagsLoading}
          loadTagValues={loadTagValues}
          onChange={handleChange}
          onRemove={handleRemove}
          onDone={handleDone}
        />
      )}
      {!wipFilter && !editing && (
        <WipInput
          key={filters.length}
          filter={{ key: '', operator: '=', value: '' }}
          index={filters.length}
          editingSegment="key"
          tagOptions={tagOptions}
          tagsLoading={tagsLoading}
          loadTagValues={loadTagValues}
          onChange={handleChange}
          onRemove={handleRemove}
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
      width: '100%',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      minHeight: 36,
      padding: theme.spacing(0.25, 0.5),
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
      maxWidth: 320,
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
      minWidth: 0,
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
