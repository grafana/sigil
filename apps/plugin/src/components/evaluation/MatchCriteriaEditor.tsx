import React, { useState } from 'react';
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
  if (!match || typeof match !== 'object') {
    return [];
  }
  return Object.entries(match).map(([key, val]) => ({
    key,
    value: Array.isArray(val) ? val.join(', ') : String(val ?? ''),
  }));
}

function fromRows(rows: CriteriaRow[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const row of rows) {
    if (!row || !row.key) {
      continue;
    }
    const val = row.value.trim();
    if (!val) {
      continue;
    }
    const values = val.includes(',')
      ? val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [val];
    if (values.length > 0) {
      result[row.key] = values.length === 1 ? values[0] : values;
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
  fieldWidth: css({
    width: 'var(--rule-form-field-width)',
    flex: 'none',
  }),
  hint: css({
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(1),
  }),
});

export default function MatchCriteriaEditor({ value, onChange, disabled }: MatchCriteriaEditorProps) {
  const styles = useStyles2(getStyles);

  const committedRows = toRows(value);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ index: number; text: string } | null>(null);

  const pendingRows: CriteriaRow[] = pendingKeys
    .filter((k) => !Object.prototype.hasOwnProperty.call(value, k))
    .map((k) => ({ key: k, value: '' }));
  const rows = [...committedRows, ...pendingRows];
  const usedKeys = new Set(rows.map((r) => r.key));

  const keyOptionsForRow = (currentKey: string): Array<SelectableValue<string>> =>
    MATCH_KEY_OPTIONS.map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.supportsGlob ? 'Supports glob patterns (e.g. assistant-*)' : undefined,
      isDisabled: opt.value !== currentKey && usedKeys.has(opt.value),
    }));

  const commitRows = (nextRows: CriteriaRow[]) => {
    onChange(fromRows(nextRows));
    setPendingKeys(nextRows.filter((r) => !r.value.trim()).map((r) => r.key));
  };

  const addRow = () => {
    const firstUnused =
      MATCH_KEY_OPTIONS.find((o) => !usedKeys.has(o.value))?.value ??
      MATCH_KEY_OPTIONS[0]?.value ??
      'agent_name';
    setPendingKeys((prev) => [...prev, firstUnused]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    setDraft(null);
    commitRows(next);
  };

  const updateRowKey = (index: number, newKey: string) => {
    const next = [...rows];
    next[index] = { ...next[index], key: newKey };
    commitRows(next);
  };

  const getDisplayValue = (index: number): string => {
    if (draft != null && draft.index === index) {
      return draft.text;
    }
    return rows[index]?.value ?? '';
  };

  const handleFocus = (index: number) => {
    setDraft({ index, text: rows[index]?.value ?? '' });
  };

  const handleChange = (index: number, val: string) => {
    setDraft({ index, text: val });
  };

  const handleBlur = (index: number) => {
    const finalValue = (draft != null && draft.index === index ? draft.text : rows[index]?.value ?? '').trim();
    setDraft(null);
    const next = [...rows];
    next[index] = { ...next[index], value: finalValue };
    commitRows(next);
  };

  return (
    <>
      {rows.map((row, index) => {
        const opt = MATCH_KEY_OPTIONS.find((o) => o.value === row.key);
        const supportsGlob = opt?.supportsGlob ?? false;
        return (
          <div key={`${row.key}-${index}`}>
            <div className={styles.row}>
              <div className={styles.fieldWidth}>
                <Select<string>
                  options={keyOptionsForRow(row.key)}
                  value={row.key}
                  onChange={(v) => {
                    if (v?.value) {
                      updateRowKey(index, v.value);
                    }
                  }}
                  disabled={disabled}
                />
              </div>
              <Input
                value={getDisplayValue(index)}
                onFocus={() => handleFocus(index)}
                onChange={(e) => handleChange(index, e.currentTarget.value)}
                onBlur={() => handleBlur(index)}
                placeholder={supportsGlob ? 'e.g. assistant-* or exact value' : 'Value'}
                disabled={disabled}
                style={{ flex: '1 1 0', minWidth: 0 }}
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
