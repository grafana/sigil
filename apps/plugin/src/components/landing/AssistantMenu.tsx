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

export function AssistantMenu({ title = 'Ask Assistant', questions, onAsk, className }: AssistantMenuProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={`${styles.menu} ${className ?? ''}`}>
      <div className={styles.headingRow}>
        <span className={styles.headingIconCircle}>
          <Icon name="ai" />
        </span>
        <Text element="h6">{title}</Text>
      </div>
      <ul className={styles.questionList}>
        {questions.map((question) => (
          <li key={question} className={styles.questionItem}>
            <Button
              variant="secondary"
              size="sm"
              fill="text"
              className={styles.questionButton}
              onClick={() => onAsk(question)}
            >
              {question}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    menu: css({
      position: 'relative',
      width: 'min(100%, 340px)',
      padding: theme.spacing(0.5, 0.5, 0.5, 0),
      display: 'grid',
      gap: theme.spacing(1),
      '&::after': {
        content: '""',
        position: 'absolute',
        left: 12,
        top: 28,
        bottom: 6,
        width: 4,
        borderRadius: 999,
        background: 'linear-gradient(180deg, rgba(168, 85, 247, 0.9) 0%, rgba(168, 85, 247, 0.45) 100%)',
      },
    }),
    headingRow: css({
      display: 'inline-flex',
      gap: theme.spacing(1),
      alignItems: 'center',
      color: theme.colors.text.secondary,
      zIndex: 1,
    }),
    headingIconCircle: css({
      width: 28,
      height: 28,
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#A855F7',
      color: theme.colors.text.primary,
      boxShadow: '0 0 0 3px rgba(168, 85, 247, 0.22), 0 0 18px rgba(168, 85, 247, 0.42)',
    }),
    questionList: css({
      position: 'relative',
      zIndex: 1,
      margin: 0,
      padding: 0,
      display: 'grid',
      gap: theme.spacing(0.75),
      listStyle: 'none',
    }),
    questionItem: css({
      position: 'relative',
      paddingLeft: theme.spacing(3.25),
      '&::before': {
        content: '""',
        position: 'absolute',
        left: 8,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 12,
        height: 12,
        borderRadius: '50%',
        border: '2px solid rgba(168, 85, 247, 0.95)',
        background: theme.colors.background.primary,
      },
    }),
    questionButton: css({
      justifyContent: 'flex-start',
      textAlign: 'left',
      width: '100%',
      height: 'auto',
      whiteSpace: 'normal',
      overflowWrap: 'break-word',
      lineHeight: 1.4,
      padding: theme.spacing(0.75, 1.25),
    }),
  };
}
