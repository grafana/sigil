import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { IconButton, Stack, Text, useStyles2 } from '@grafana/ui';
import type { GenerationDetail } from '../../conversation/types';

export type GenerationStepperProps = {
  generations: GenerationDetail[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    background: theme.colors.background.secondary,
    borderRadius: '8px',
  }),
});

export default function GenerationStepper({ generations, currentIndex, onSelectIndex }: GenerationStepperProps) {
  const styles = useStyles2(getStyles);
  const total = generations.length;

  if (total === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <Stack direction="row" gap={1} alignItems="center">
        <IconButton
          name="angle-left"
          size="md"
          aria-label="previous generation"
          onClick={() => onSelectIndex(currentIndex - 1)}
          disabled={currentIndex <= 0}
        />
        <Text weight="medium">
          Generation {currentIndex + 1} of {total}
        </Text>
        <IconButton
          name="angle-right"
          size="md"
          aria-label="next generation"
          onClick={() => onSelectIndex(currentIndex + 1)}
          disabled={currentIndex >= total - 1}
        />
      </Stack>
    </div>
  );
}
