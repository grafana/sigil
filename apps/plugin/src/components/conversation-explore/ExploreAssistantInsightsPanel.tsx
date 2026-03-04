import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Spinner, useStyles2 } from '@grafana/ui';

export type AssistantInsightDisplayItem = {
  itemId: string;
  sidebarLabel: string;
  focus: string;
  tip: string;
};

export type ExploreAssistantInsightsPanelProps = {
  isGenerating: boolean;
  rawAssistantText: string;
  items: AssistantInsightDisplayItem[];
  onSelectItem: (itemId: string) => void;
};

export default function ExploreAssistantInsightsPanel({
  isGenerating,
  rawAssistantText,
  items,
  onSelectItem,
}: ExploreAssistantInsightsPanelProps) {
  const styles = useStyles2(getStyles);
  const hasItems = items.length > 0;

  return (
    <aside className={styles.container} aria-label="assistant insights">
      <div className={styles.body}>
        {hasItems ? (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={`${item.itemId}:${item.focus}`} className={styles.listItem}>
                <button type="button" className={styles.linkButton} onClick={() => onSelectItem(item.itemId)}>
                  {item.sidebarLabel}
                </button>
                <div className={styles.focusText}>{item.focus}</div>
                <div className={styles.tipText}>Tip: {item.tip}</div>
              </li>
            ))}
          </ul>
        ) : isGenerating ? (
          <div className={styles.loaderWrap}>
            <Spinner size="sm" />
          </div>
        ) : rawAssistantText.trim().length > 0 ? (
          <div className={styles.placeholder}>Could not map assistant output to selectable sidebar items.</div>
        ) : (
          <div className={styles.placeholder}>Waiting for highlighted sidebar items.</div>
        )}
      </div>
    </aside>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
    }),
    body: css({
      minHeight: 0,
      overflowY: 'auto',
      padding: theme.spacing(1.5),
    }),
    loaderWrap: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 20,
    }),
    list: css({
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.25),
    }),
    listItem: css({
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      padding: theme.spacing(1.25),
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.75),
    }),
    linkButton: css({
      display: 'inline-flex',
      width: 'fit-content',
      border: 'none',
      padding: 0,
      background: 'transparent',
      color: theme.colors.primary.text,
      textDecoration: 'underline',
      fontSize: theme.typography.bodySmall.fontSize,
      fontFamily: theme.typography.fontFamilyMonospace,
      cursor: 'pointer',
      '&:hover': {
        color: theme.colors.primary.main,
      },
    }),
    focusText: css({
      color: theme.colors.text.primary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.4,
    }),
    tipText: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.4,
      fontStyle: 'italic',
    }),
    placeholder: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
    }),
  };
}
