import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { useSearchParams } from 'react-router-dom';
import { SparklesBackground } from '../components/landing/SparklesBackground';
import MarkdownPreview from '../components/markdown/MarkdownPreview';

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
      <div className={styles.centerText}>
        <MarkdownPreview markdown={text} className={styles.markdownContent} />
      </div>
      {isEditing && (
        <div className={styles.editPanelBackdrop}>
          <form
            className={styles.editPanel}
            onSubmit={handleSubmit}
            onDoubleClick={(event) => event.stopPropagation()}
          >
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
      textAlign: 'left' as const,
      pointerEvents: 'none',
      padding: theme.spacing(4),
      color: theme.colors.text.primary,
      fontSize: 'clamp(1.5rem, 2.8vw, 2.5rem)',
      lineHeight: 1.25,
      fontWeight: theme.typography.fontWeightMedium,
      textShadow: `0 12px 36px ${theme.colors.background.primary}`,
      wordBreak: 'break-word' as const,
    }),
    markdownContent: css({
      width: 'min(90vw, 1280px)',
      margin: '0 auto',
      transform: 'translateY(-8%)',
      textAlign: 'left' as const,
      color: theme.colors.text.primary,
      '& h1, & h2, & h3, & h4, & h5, & h6': {
        marginTop: theme.spacing(1),
        marginBottom: theme.spacing(2),
        fontFamily: '"Poppins", "Avenir Next", "Segoe UI", sans-serif',
        letterSpacing: '-0.02em',
        fontWeight: 700,
        color: theme.colors.primary.contrastText,
        textShadow: `0 0 14px ${theme.colors.primary.main}`,
      },
      '& h1': {
        fontSize: 'clamp(3rem, 8vw, 7rem)',
        lineHeight: 1.05,
      },
      '& h2': {
        fontSize: 'clamp(2.5rem, 6vw, 5rem)',
        lineHeight: 1.08,
      },
      '& h3, & h4, & h5, & h6': {
        fontSize: 'clamp(2rem, 4.8vw, 3.6rem)',
        lineHeight: 1.12,
      },
      '& p': {
        margin: `${theme.spacing(1)} 0`,
        maxWidth: '40ch',
        fontSize: 'clamp(1.4rem, 2.8vw, 2.5rem)',
        lineHeight: 1.3,
        fontWeight: 500,
      },
      '& ul, & ol': {
        margin: `${theme.spacing(2)} 0`,
        paddingLeft: theme.spacing(4),
        maxWidth: '38ch',
        listStylePosition: 'outside' as const,
        textAlign: 'left' as const,
      },
      '& li': {
        marginBottom: theme.spacing(1),
        fontSize: 'clamp(1.25rem, 2.4vw, 2.2rem)',
        lineHeight: 1.3,
        fontWeight: 600,
      },
      '& pre': {
        margin: `${theme.spacing(2)} 0`,
        maxWidth: '80vw',
        textAlign: 'left' as const,
      },
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
