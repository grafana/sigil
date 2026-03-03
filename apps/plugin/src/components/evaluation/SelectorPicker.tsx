import React from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { RadioButtonGroup, Text, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { SELECTOR_OPTIONS, type RuleSelector } from '../../evaluation/types';

export type SelectorPickerProps = {
  value: RuleSelector;
  onChange: (v: RuleSelector) => void;
  disabled?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  description: css({
    marginTop: theme.spacing(1),
    color: theme.colors.text.secondary,
  }),
});

export default function SelectorPicker({ value, onChange, disabled }: SelectorPickerProps) {
  const styles = useStyles2(getStyles);

  const options: Array<SelectableValue<RuleSelector>> = SELECTOR_OPTIONS.map((opt) => ({
    label: opt.label,
    value: opt.value,
  }));

  const currentOption = SELECTOR_OPTIONS.find((o) => o.value === value);
  const description = currentOption?.description ?? '';

  return (
    <>
      <RadioButtonGroup<RuleSelector> options={options} value={value} onChange={onChange} disabled={disabled} />
      {description && (
        <div className={styles.description}>
          <Text variant="bodySmall" color="secondary">
            {description}
          </Text>
        </div>
      )}
    </>
  );
}
