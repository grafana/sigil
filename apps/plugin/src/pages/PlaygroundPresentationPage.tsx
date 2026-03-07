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
  durationScale?: number;
  sizeScale?: number;
  maxSparks?: number;
  withGlow?: boolean;
};

function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) + 1;
}

function PresentationSparkles({
  color,
  seed,
  delaySec,
  className,
  durationScale = 1.6,
  sizeScale = 1.1,
  maxSparks = 4,
  withGlow = false,
}: PresentationSparklesProps) {
  return (
    <FastSparkles
      color={color}
      durationScale={durationScale}
      sizeScale={sizeScale}
      maxSparks={maxSparks}
      withGlow={withGlow}
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
  const [isTitleFlurryActive, setIsTitleFlurryActive] = React.useState(true);
  const [draftText, setDraftText] = React.useState('');
  const [boostedBoldKeys, setBoostedBoldKeys] = React.useState<Record<string, boolean>>({});
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const boldBoostTimeoutsRef = React.useRef<Map<string, number>>(new Map());
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

  React.useEffect(() => {
    const flurryTimeout = window.setTimeout(() => {
      setIsTitleFlurryActive(false);
    }, 2800);

    return () => {
      window.clearTimeout(flurryTimeout);
    };
  }, []);

  React.useEffect(() => {
    const timeoutMap = boldBoostTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeoutMap.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutMap.clear();
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

  const triggerBoldSparkleBoost = React.useCallback((key: string) => {
    const existingTimeout = boldBoostTimeoutsRef.current.get(key);
    if (existingTimeout !== undefined) {
      window.clearTimeout(existingTimeout);
    }

    setBoostedBoldKeys((current) => ({ ...current, [key]: true }));

    const timeoutId = window.setTimeout(() => {
      setBoostedBoldKeys((current) => ({ ...current, [key]: false }));
      boldBoostTimeoutsRef.current.delete(key);
    }, 2800);

    boldBoostTimeoutsRef.current.set(key, timeoutId);
  }, []);

  return (
    <div className={styles.page} onDoubleClick={startEditing}>
      <SparklesBackground className={styles.presentationLayer} withGradient />
      <div className={styles.centerText}>
        <MarkdownPreview
          markdown={text}
          className={styles.markdownContent}
          renderHeading={({ level, text: headingText, key, className, children }) => {
            const HeadingTag = `h${level}` as keyof React.JSX.IntrinsicElements;
            if (level !== 1) {
              return (
                <HeadingTag key={key} className={className}>
                  {children}
                </HeadingTag>
              );
            }

            const baseSeed = seedFromString(`${key}:${headingText}`);
            return (
              <HeadingTag key={key} className={className}>
                <span className={styles.titleSparkleWrap}>
                  <span className={styles.titleSparkleText}>{children}</span>
                  <span className={styles.titleSparkleLayer} aria-hidden>
                    <PresentationSparkles color="#5794F2" seed={baseSeed + 5} className={styles.titleSparkleSwarm} />
                    <PresentationSparkles
                      color="#B877D9"
                      seed={baseSeed + 17}
                      delaySec={0.2}
                      className={styles.titleSparkleSwarm}
                    />
                    <PresentationSparkles
                      color="#FF9830"
                      seed={baseSeed + 31}
                      delaySec={0.4}
                      className={styles.titleSparkleSwarm}
                    />
                  </span>
                  <span className={styles.titleBoostedSparkleLayer(isTitleFlurryActive)} aria-hidden>
                    <PresentationSparkles
                      color="#5794F2"
                      seed={baseSeed + 53}
                      className={styles.titleBoostedSparkleSwarm}
                      durationScale={0.48}
                      sizeScale={1.3}
                      maxSparks={12}
                      withGlow
                    />
                    <PresentationSparkles
                      color="#B877D9"
                      seed={baseSeed + 71}
                      delaySec={0.1}
                      className={styles.titleBoostedSparkleSwarm}
                      durationScale={0.52}
                      sizeScale={1.3}
                      maxSparks={12}
                      withGlow
                    />
                    <PresentationSparkles
                      color="#FF9830"
                      seed={baseSeed + 89}
                      delaySec={0.2}
                      className={styles.titleBoostedSparkleSwarm}
                      durationScale={0.56}
                      sizeScale={1.35}
                      maxSparks={12}
                      withGlow
                    />
                  </span>
                </span>
              </HeadingTag>
            );
          }}
          renderStrong={(strongText, key) => {
            const baseSeed = seedFromString(key);
            const isBoosted = Boolean(boostedBoldKeys[key]);
            return (
              <strong
                key={key}
                className={styles.boldSparkleWrap}
                onClick={() => {
                  triggerBoldSparkleBoost(key);
                }}
              >
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
                <span className={styles.boostedSparkleLayer(isBoosted)} aria-hidden>
                  <PresentationSparkles
                    color="#5794F2"
                    seed={baseSeed + 71}
                    className={styles.boostedSparkleSwarm}
                    durationScale={0.55}
                    sizeScale={1.2}
                    maxSparks={10}
                    withGlow
                  />
                  <PresentationSparkles
                    color="#B877D9"
                    seed={baseSeed + 89}
                    delaySec={0.1}
                    className={styles.boostedSparkleSwarm}
                    durationScale={0.6}
                    sizeScale={1.2}
                    maxSparks={10}
                    withGlow
                  />
                  <PresentationSparkles
                    color="#FF9830"
                    seed={baseSeed + 107}
                    delaySec={0.2}
                    className={styles.boostedSparkleSwarm}
                    durationScale={0.65}
                    sizeScale={1.25}
                    maxSparks={10}
                    withGlow
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
        fontSize: 'clamp(2rem, 5.2vw, 4.8rem)',
        lineHeight: 1.05,
        marginBottom: theme.spacing(6),
      },
      '& h2': {
        fontSize: 'clamp(1.8rem, 4.4vw, 3.8rem)',
        lineHeight: 1.08,
      },
      '& h3, & h4, & h5, & h6': {
        fontSize: 'clamp(1.55rem, 3.6vw, 2.8rem)',
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
      pointerEvents: 'auto',
      cursor: 'pointer',
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
    boostedSparkleLayer: (isActive: boolean) =>
      css({
        position: 'absolute',
        left: '-0.25em',
        right: '-0.25em',
        top: '-0.14em',
        height: '1.28em',
        pointerEvents: 'none',
        zIndex: 1,
        opacity: isActive ? 1 : 0,
        transition: 'opacity 1100ms ease-out',
        overflow: 'visible',
      }),
    boostedSparkleSwarm: css({
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
      },
    }),
    titleSparkleWrap: css({
      position: 'relative',
      display: 'inline-block',
      overflow: 'visible',
      isolation: 'isolate',
    }),
    titleSparkleText: css({
      position: 'relative',
      zIndex: 2,
    }),
    titleSparkleLayer: css({
      position: 'absolute',
      left: '-0.2em',
      right: '-0.2em',
      top: '-0.1em',
      height: '1.2em',
      pointerEvents: 'none',
      zIndex: 1,
      opacity: 1,
      overflow: 'visible',
    }),
    titleSparkleSwarm: css({
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
    titleBoostedSparkleLayer: (isActive: boolean) =>
      css({
        position: 'absolute',
        left: '-0.28em',
        right: '-0.28em',
        top: '-0.14em',
        height: '1.32em',
        pointerEvents: 'none',
        zIndex: 1,
        opacity: isActive ? 1 : 0,
        transition: 'opacity 1400ms ease-out',
        overflow: 'visible',
      }),
    titleBoostedSparkleSwarm: css({
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
      },
    }),
  };
}
