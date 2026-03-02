import React from 'react';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Badge, IconButton, Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { EVALUATOR_KIND_LABELS, formatEvaluatorId, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorPickerProps = {
  value: string[];
  evaluators: Evaluator[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  chips: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),
  chip: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
  }),
});

export default function EvaluatorPicker({ value, evaluators, onChange, disabled }: EvaluatorPickerProps) {
  const styles = useStyles2(getStyles);
  const selectedSet = new Set(value);

  const options: Array<SelectableValue<string>> = evaluators
    .filter((e) => !selectedSet.has(e.evaluator_id))
    .map((e) => ({
      label: `${formatEvaluatorId(e.evaluator_id)} (${EVALUATOR_KIND_LABELS[e.kind]})`,
      value: e.evaluator_id,
    }));

  const handleAdd = (sel: SelectableValue<string>) => {
    if (sel?.value && !selectedSet.has(sel.value)) {
      onChange([...value, sel.value]);
    }
  };

  const handleRemove = (id: string) => {
    onChange(value.filter((v) => v !== id));
  };

  return (
    <>
      <Select<string>
        options={options}
        value={null}
        onChange={handleAdd}
        placeholder="Add evaluator..."
        isClearable={false}
        width={40}
        disabled={disabled}
      />
      {value.length > 0 && (
        <div className={styles.chips}>
          {value.map((id) => {
            const evaluator = evaluators.find((e) => e.evaluator_id === id);
            const kind = evaluator?.kind ?? 'llm_judge';
            const name = evaluator ? formatEvaluatorId(evaluator.evaluator_id) : id;
            return (
              <div key={id} className={styles.chip}>
                <Badge text={EVALUATOR_KIND_LABELS[kind]} color={getKindBadgeColor(kind)} />
                <span>{name}</span>
                {!disabled && (
                  <IconButton
                    name="times"
                    size="sm"
                    tooltip="Remove"
                    onClick={() => handleRemove(id)}
                    aria-label={`Remove ${name}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
