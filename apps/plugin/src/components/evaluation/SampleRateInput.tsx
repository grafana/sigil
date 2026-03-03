import React from 'react';
import { Field, Input, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export type SampleRateInputProps = {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  inputWrapper: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  input: css({
    width: 'var(--rule-form-field-width)',
    flex: 'none',
  }),
});

export default function SampleRateInput({ value, onChange, disabled }: SampleRateInputProps) {
  const styles = useStyles2(getStyles);

  const displayValue = Math.round(value * 100);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.currentTarget.value;
    if (raw === '') {
      onChange(0);
      return;
    }
    const num = parseInt(raw, 10);
    if (!Number.isNaN(num)) {
      const clamped = Math.max(0, Math.min(100, num));
      onChange(clamped / 100);
    }
  };

  return (
    <Field
      label="Sample rate"
      description="Percentage of matching generations to evaluate (0–100%). Lower values reduce cost and latency."
    >
      <div className={styles.inputWrapper}>
        <Input
          className={styles.input}
          type="number"
          min={0}
          max={100}
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
        />
        <Text color="secondary">%</Text>
      </div>
    </Field>
  );
}
