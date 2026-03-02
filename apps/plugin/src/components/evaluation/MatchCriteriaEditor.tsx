import React from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, IconButton, Input, Select, Stack, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { MATCH_KEY_OPTIONS } from '../../evaluation/types';

export type MatchCriteriaEditorProps = {
  value: Record<string, string | string[]>;
  onChange: (v: Record<string, string | string[]>) => void;
  disabled?: boolean;
};

type CriteriaRow = { key: string; value: string };

function toRows(match: Record<string, string | string[]>): CriteriaRow[] {
  return Object.entries(match).map(([key, val]) => ({
    key,
    value: Array.isArray(val) ? val.join(', ') : val,
  }));
}

function fromRows(rows: CriteriaRow[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const row of rows) {
    if (row.key) {
      const val = row.value.trim();
      result[row.key] = val.includes(',')
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : val;
    }
  }
  return result;
}

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),
  keySelect: css({
    minWidth: 180,
  }),
  valueInput: css({
    flex: 1,
  }),
  hint: css({
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(1),
  }),
});

export default function MatchCriteriaEditor({ value, onChange, disabled }: MatchCriteriaEditorProps) {
  const styles = useStyles2(getStyles);
  const rows = toRows(value);

  const usedKeys = new Set(rows.map((r) => r.key));

  const keyOptionsForRow = (currentKey: string): Array<SelectableValue<string>> =>
    MATCH_KEY_OPTIONS.map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.supportsGlob ? 'Supports glob patterns (e.g. assistant-*)' : undefined,
      isDisabled: opt.value !== currentKey && usedKeys.has(opt.value),
    }));

  const updateRow = (index: number, updates: Partial<CriteriaRow>) => {
    const next = [...rows];
    next[index] = { ...next[index], ...updates };
    onChange(fromRows(next));
  };

  const addRow = () => {
    const firstUnused = MATCH_KEY_OPTIONS.find((o) => !usedKeys.has(o.value))?.value ?? MATCH_KEY_OPTIONS[0].value;
    onChange(fromRows([...rows, { key: firstUnused, value: '' }]));
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(fromRows(next));
  };

  return (
    <>
      {rows.map((row, index) => {
        const opt = MATCH_KEY_OPTIONS.find((o) => o.value === row.key);
        const supportsGlob = opt?.supportsGlob ?? false;
        return (
          <div key={`${row.key}-${index}`}>
            <div className={styles.row}>
              <Select<string>
                className={styles.keySelect}
                options={keyOptionsForRow(row.key)}
                value={row.key}
                onChange={(v) => {
                  if (v?.value) {
                    updateRow(index, { key: v.value });
                  }
                }}
                disabled={disabled}
              />
              <Input
                className={styles.valueInput}
                value={row.value}
                onChange={(e) => updateRow(index, { value: e.currentTarget.value })}
                placeholder={supportsGlob ? 'e.g. assistant-* or exact value' : 'Value'}
                disabled={disabled}
              />
              {!disabled && (
                <IconButton
                  name="trash-alt"
                  tooltip="Remove"
                  onClick={() => removeRow(index)}
                  aria-label="Remove criteria"
                />
              )}
            </div>
            {supportsGlob && (
              <div className={styles.hint}>
                <Text variant="bodySmall" color="secondary">
                  Supports glob patterns (e.g. assistant-*, gpt-*)
                </Text>
              </div>
            )}
          </div>
        );
      })}
      {!disabled && (
        <Stack direction="row" gap={1} alignItems="center">
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            onClick={addRow}
            disabled={usedKeys.size >= MATCH_KEY_OPTIONS.length}
          >
            Add criteria
          </Button>
        </Stack>
      )}
    </>
  );
}
