import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { useSearchParams } from 'react-router-dom';
import { SparklesBackground } from '../components/landing/SparklesBackground';

export default function PlaygroundPresentationPage() {
  const styles = useStyles2(getStyles);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftText, setDraftText] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const text = searchParams.get('text')?.trim() || 'Presentation playground';

  React.useEffect(() => {
    if (!isEditing || !textareaRef.current) {
      return;
    }
    textareaRef.current.focus();
    textareaRef.current.select();
  }, [isEditing]);

  const startEditing = React.useCallback(() => {
    setDraftText(text);
    setIsEditing(true);
  }, [text]);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextParams = new URLSearchParams(searchParams);
      const nextText = draftText.trim();
      if (nextText.length > 0) {
        nextParams.set('text', nextText);
      } else {
        nextParams.delete('text');
      }
      setSearchParams(nextParams);
      setIsEditing(false);
    },
    [draftText, searchParams, setSearchParams]
  );

  return (
    <div className={styles.page} onDoubleClick={startEditing}>
      <SparklesBackground className={styles.presentationLayer} withGradient />
      <div className={styles.centerText}>{text}</div>
      {isEditing && (
        <div className={styles.editPanelBackdrop}>
          <form
            className={styles.editPanel}
            onSubmit={handleSubmit}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <label className={styles.editLabel} htmlFor="presentation-text-editor">
              Edit text
            </label>
            <textarea
              id="presentation-text-editor"
              ref={textareaRef}
              className={styles.textarea}
              value={draftText}
              onChange={(event) => setDraftText(event.currentTarget.value)}
              rows={6}
            />
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    page: css({
      position: 'relative',
      width: '100%',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      borderRadius: 0,
    }),
    presentationLayer: css({
      position: 'absolute',
      inset: 0,
      zIndex: 1,
    }),
    centerText: css({
      position: 'absolute',
      inset: 0,
      zIndex: 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
      pointerEvents: 'none',
      padding: theme.spacing(2),
      color: theme.colors.text.primary,
      fontSize: theme.typography.h2.fontSize,
      lineHeight: theme.typography.h2.lineHeight,
      fontWeight: theme.typography.fontWeightMedium,
      textShadow: `0 0 24px ${theme.colors.background.primary}`,
      wordBreak: 'break-word' as const,
    }),
    editPanelBackdrop: css({
      position: 'absolute',
      inset: 0,
      zIndex: 3,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.colors.background.secondary,
      backdropFilter: 'blur(2px)',
      padding: theme.spacing(2),
    }),
    editPanel: css({
      width: '100%',
      maxWidth: 640,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z3,
    }),
    editLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    textarea: css({
      width: '100%',
      minHeight: 160,
      resize: 'vertical' as const,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.canvas,
      color: theme.colors.text.primary,
      padding: theme.spacing(1),
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: 1,
      },
    }),
    actions: css({
      display: 'flex',
      justifyContent: 'flex-end',
      gap: theme.spacing(1),
    }),
  };
}
