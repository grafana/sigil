import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { useSearchParams } from 'react-router-dom';
import { FastSparkles } from '../components/landing/FastSparkles';
import { SparklesBackground } from '../components/landing/SparklesBackground';
import MarkdownPreview from '../components/markdown/MarkdownPreview';

type PresentationSparklesProps = {
  color: string;
  seed: number;
  delaySec?: number;
  className?: string;
};

function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) + 1;
}

function PresentationSparkles({ color, seed, delaySec, className }: PresentationSparklesProps) {
  return (
    <FastSparkles
      color={color}
      durationScale={1.6}
      sizeScale={1.1}
      maxSparks={4}
      withGlow={false}
      seed={seed}
      delaySec={delaySec}
      className={className}
    />
  );
}

export default function PlaygroundPresentationPage() {
  const styles = useStyles2(getStyles);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditing, setIsEditing] = React.useState(false);
  const [showEditHint, setShowEditHint] = React.useState(true);
  const [isEditHintVisible, setIsEditHintVisible] = React.useState(false);
  const [isEditHintFading, setIsEditHintFading] = React.useState(false);
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

  React.useEffect(() => {
    const fadeInTimeout = window.setTimeout(() => {
      setIsEditHintVisible(true);
    }, 80);

    const fadeTimeout = window.setTimeout(() => {
      setIsEditHintFading(true);
    }, 2600);

    const hintTimeout = window.setTimeout(() => {
      setShowEditHint(false);
    }, 3500);

    return () => {
      window.clearTimeout(fadeInTimeout);
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(hintTimeout);
    };
  }, []);

  const startEditing = React.useCallback(() => {
    setShowEditHint(false);
    setIsEditHintVisible(false);
    setIsEditHintFading(false);
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
        <MarkdownPreview
          markdown={text}
          className={styles.markdownContent}
          renderStrong={(strongText, key) => {
            const baseSeed = seedFromString(key);
            return (
              <strong key={key} className={styles.boldSparkleWrap}>
                <span className={styles.boldSparkleText}>{strongText}</span>
              <span className={styles.boldSparkleLayer} aria-hidden>
                  <PresentationSparkles color="#5794F2" seed={baseSeed + 11} className={styles.boldSparkleSwarm} />
                <PresentationSparkles
                  color="#B877D9"
                    seed={baseSeed + 29}
                  delaySec={0.22}
                  className={styles.boldSparkleSwarm}
                />
                <PresentationSparkles
                  color="#FF9830"
                    seed={baseSeed + 47}
                  delaySec={0.44}
                  className={styles.boldSparkleSwarm}
                />
              </span>
              </strong>
            );
          }}
        />
      </div>
      {!isEditing && showEditHint && (
        <div className={styles.editHint(isEditHintVisible, isEditHintFading)}>(double-click to edit)</div>
      )}
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
      alignItems: 'flex-start',
      justifyContent: 'center',
      textAlign: 'left' as const,
      pointerEvents: 'none',
      padding: `${theme.spacing(8)} ${theme.spacing(10)} ${theme.spacing(6)}`,
      color: theme.colors.text.primary,
      fontSize: 'clamp(1.5rem, 2.8vw, 2.5rem)',
      lineHeight: 1.25,
      fontWeight: theme.typography.fontWeightMedium,
      textShadow: `0 12px 36px ${theme.colors.background.primary}`,
      wordBreak: 'break-word' as const,
    }),
    markdownContent: css({
      width: '100%',
      margin: 0,
      transform: 'none',
      textAlign: 'left' as const,
      color: theme.colors.text.primary,
      '& h1, & h2, & h3, & h4, & h5, & h6': {
        marginTop: theme.spacing(1),
        marginBottom: theme.spacing(3.5),
        fontFamily: '"Poppins", "Avenir Next", "Segoe UI", sans-serif',
        letterSpacing: '-0.02em',
        fontWeight: 700,
        color: theme.colors.primary.contrastText,
        textShadow: `0 0 14px ${theme.colors.primary.main}`,
      },
      '& h1': {
        fontSize: 'clamp(2.4rem, 6.5vw, 5.8rem)',
        lineHeight: 1.05,
      },
      '& h2': {
        fontSize: 'clamp(2.1rem, 5.2vw, 4.4rem)',
        lineHeight: 1.08,
      },
      '& h3, & h4, & h5, & h6': {
        fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
        lineHeight: 1.12,
      },
      '& p': {
        margin: `${theme.spacing(1)} 0`,
        maxWidth: 'none',
        fontSize: 'clamp(5.4rem, 10vw, 9.4rem)',
        lineHeight: 1.3,
        fontWeight: 500,
      },
      '& strong, & b': {
        fontWeight: 800,
        color: theme.colors.text.maxContrast,
      },
      '& ul, & ol': {
        margin: `${theme.spacing(2)} 0`,
        paddingLeft: theme.spacing(8),
        maxWidth: 'none',
        listStylePosition: 'outside' as const,
        textAlign: 'left' as const,
      },
      '& li': {
        marginBottom: theme.spacing(2),
        fontSize: 'clamp(1.5rem, 2.9vw, 2.7rem)',
        lineHeight: 1.45,
        fontWeight: 600,
      },
      '& li::marker': {
        fontSize: '1.3em',
        fontWeight: 700,
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
    editHint: (isVisible: boolean, isFading: boolean) =>
      css({
      position: 'absolute',
      top: theme.spacing(3),
      right: theme.spacing(4),
      zIndex: 2,
      color: theme.colors.text.primary,
      opacity: isFading ? 0 : isVisible ? 0.8 : 0,
      transition: 'opacity 800ms ease',
      fontSize: 'clamp(1.1rem, 2.2vw, 1.7rem)',
      lineHeight: 1.1,
      fontWeight: theme.typography.fontWeightBold,
      textShadow: `0 8px 24px ${theme.colors.background.primary}`,
      pointerEvents: 'none',
      userSelect: 'none' as const,
    }),
    boldSparkleWrap: css({
      position: 'relative',
      display: 'inline-block',
      fontWeight: 800,
      color: theme.colors.text.maxContrast,
      overflow: 'visible',
      isolation: 'isolate',
    }),
    boldSparkleText: css({
      position: 'relative',
      zIndex: 2,
    }),
    boldSparkleLayer: css({
      position: 'absolute',
      left: '-0.18em',
      right: '-0.18em',
      top: '-0.08em',
      height: '1.12em',
      pointerEvents: 'none',
      zIndex: 1,
      opacity: 1,
      overflow: 'visible',
    }),
    boldSparkleSwarm: css({
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      display: 'block',
      overflow: 'visible',
      '&, & > div': {
        pointerEvents: 'none',
      },
      '&&': {
        overflow: 'visible',
        opacity: 1,
      },
    }),
  };
}
