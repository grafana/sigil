import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Text, useStyles2 } from '@grafana/ui';

export type AssistantMenuProps = {
  title?: string;
  questions: string[];
  onAsk: (question: string) => void;
  className?: string;
};

export function AssistantMenu({ title = 'Ask Grafana Assistant', questions, onAsk, className }: AssistantMenuProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={`${styles.menu} ${className ?? ''}`}>
      <div className={styles.headingRow}>
        <Icon name="ai" />
        <Text element="h6">{title}</Text>
      </div>
      <div className={styles.questionList}>
        {questions.map((question) => (
          <Button key={question} variant="secondary" size="sm" fill="text" onClick={() => onAsk(question)}>
            {question}
          </Button>
        ))}
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    menu: css({
      width: 'min(100%, 340px)',
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z2,
      padding: theme.spacing(1.5),
      display: 'grid',
      gap: theme.spacing(1),
    }),
    headingRow: css({
      display: 'inline-flex',
      gap: theme.spacing(1),
      alignItems: 'center',
      color: theme.colors.text.secondary,
    }),
    questionList: css({
      display: 'grid',
      gap: theme.spacing(0.75),
      '& button': {
        justifyContent: 'flex-start',
        textAlign: 'left',
      },
    }),
  };
}
