import React from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { SELECTOR_OPTIONS, type RuleSelector } from '../../evaluation/types';

export type SelectorPickerProps = {
  value: RuleSelector;
  onChange: (v: RuleSelector) => void;
  disabled?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  select: css({
    width: '100%',
  }),
});

export default function SelectorPicker({ value, onChange, disabled }: SelectorPickerProps) {
  const styles = useStyles2(getStyles);

  const options: Array<SelectableValue<RuleSelector>> = SELECTOR_OPTIONS.map((opt) => ({
    label: opt.label,
    value: opt.value,
    description: opt.description,
  }));

  return (
    <Select<RuleSelector>
      className={styles.select}
      options={options}
      value={value}
      onChange={(v) => v?.value != null && onChange(v.value)}
      disabled={disabled}
    />
  );
}
