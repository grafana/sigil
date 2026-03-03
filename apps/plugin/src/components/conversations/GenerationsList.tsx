import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { GenerationDetail } from '../../conversation/types';
import GenerationItem from './GenerationItem';

export type GenerationsListProps = {
  generations: GenerationDetail[];
  emptyMessage?: string;
  alwaysShowMetadata?: boolean;
  selectedTraceID?: string;
  onSelectTrace?: (traceID: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'generationsList-container',
    display: 'grid',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1.5),
  }),
  list: css({
    label: 'generationsList-list',
    display: 'grid',
    gap: 0,
  }),
  empty: css({
    label: 'generationsList-empty',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export default function GenerationsList({
  generations,
  emptyMessage,
  alwaysShowMetadata = false,
  selectedTraceID,
  onSelectTrace,
}: GenerationsListProps) {
  const styles = useStyles2(getStyles);
  const resolvedEmptyMessage = emptyMessage ?? 'No generations found for this conversation.';

  return (
    <section className={styles.container}>
      {generations.length === 0 ? (
        <div className={styles.empty}>{resolvedEmptyMessage}</div>
      ) : (
        <div className={styles.list}>
          {generations.map((generation, index) => (
            <GenerationItem
              key={generation.generation_id}
              generation={generation}
              index={index}
              total={generations.length}
              groupedChatPreview
              isFirst={index === 0}
              isLast={index === generations.length - 1}
              borderlessPreview
              alwaysShowMetadata={alwaysShowMetadata}
              selectedTraceID={selectedTraceID}
              onSelectTrace={onSelectTrace}
            />
          ))}
        </div>
      )}
    </section>
  );
}
