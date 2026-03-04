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

export function AssistantMenu({ title = 'Learn more', questions, onAsk, className }: AssistantMenuProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={`${styles.menu} ${className ?? ''}`}>
      <div className={styles.headingRow}>
        <Text element="h3">{title}</Text>
        <span className={styles.headingIconCircle}>
          <Icon name="ai" />
        </span>
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
        <li className={styles.questionItem}>
          <Button variant="secondary" size="sm" fill="text" className={styles.questionButton} onClick={() => onAsk('')}>
            Something else
          </Button>
        </li>
      </ul>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    menu: css({
      width: '100%',
      minWidth: 0,
      padding: 0,
      display: 'grid',
      gap: theme.spacing(1.25),
    }),
    headingRow: css({
      display: 'flex',
      gap: theme.spacing(1),
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      width: '100%',
      paddingRight: theme.spacing(0.5),
      color: theme.colors.text.primary,
      marginBottom: theme.spacing(0.25),
    }),
    headingIconCircle: css({
      width: 32,
      height: 32,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      marginTop: theme.spacing(0.25),
      color: theme.colors.text.primary,
      '& svg': {
        width: 18,
        height: 18,
      },
    }),
    questionList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
      paddingRight: theme.spacing(0.5),
      listStyle: 'disc',
    }),
    questionItem: css({
      display: 'list-item',
    }),
    questionButton: css({
      justifyContent: 'flex-start',
      textAlign: 'left',
      width: 'auto',
      height: 'auto',
      whiteSpace: 'normal',
      overflowWrap: 'break-word',
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.4,
      border: 0,
      background: 'transparent',
      color: theme.colors.text.link,
      padding: 0,
      '&:hover': {
        background: 'transparent',
        textDecoration: 'underline',
      },
      '&:focus, &:focus-visible, &:active': {
        background: 'transparent',
      },
      '&::before': {
        background: 'transparent',
      },
      '& > span': {
        width: '100%',
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        textAlign: 'left',
      },
    }),
  };
}
