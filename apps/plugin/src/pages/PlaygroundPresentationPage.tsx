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

type PresentationEffect = 'none' | 'typewriter';
type VerticalAlign = 'top' | 'middle' | 'bottom';
type HorizontalAlign = 'left' | 'middle' | 'right';

const AI_HIGHLIGHT_COLORS = ['#5794F2', '#B877D9', '#FF9830'] as const;
const HIGHLIGHT_HUE_ROTATIONS = [-16, -10, -6, 0, 6, 10, 16] as const;
const TYPEWRITER_CARET_TOKEN = 'sigil-typewriter-caret-token';
const DEFAULT_EFFECT_SPEED = 1;
const MIN_EFFECT_SPEED = 0.25;
const MAX_EFFECT_SPEED = 4;
const EFFECT_SPEED_OPTIONS = [
  { label: 'Slow', value: 0.7 },
  { label: 'Medium', value: 1 },
  { label: 'Fast', value: 1.6 },
  { label: 'Very fast', value: 2.4 },
] as const;
const POSITION_SEGMENTS: Array<{
  key: string;
  label: string;
  valign: VerticalAlign;
  halign: HorizontalAlign;
}> = [
  { key: 'top-left', label: 'Top left', valign: 'top', halign: 'left' },
  { key: 'top-middle', label: 'Top middle', valign: 'top', halign: 'middle' },
  { key: 'top-right', label: 'Top right', valign: 'top', halign: 'right' },
  { key: 'middle-left', label: 'Middle left', valign: 'middle', halign: 'left' },
  { key: 'middle-middle', label: 'Middle', valign: 'middle', halign: 'middle' },
  { key: 'middle-right', label: 'Middle right', valign: 'middle', halign: 'right' },
  { key: 'bottom-left', label: 'Bottom left', valign: 'bottom', halign: 'left' },
  { key: 'bottom-middle', label: 'Bottom middle', valign: 'bottom', halign: 'middle' },
  { key: 'bottom-right', label: 'Bottom right', valign: 'bottom', halign: 'right' },
];

type EffectSpeedPreset = (typeof EFFECT_SPEED_OPTIONS)[number]['label'];
type EffectSpeedOption = (typeof EFFECT_SPEED_OPTIONS)[number];

function parseEffectSpeed(rawValue: string | null): number {
  const parsed = Number.parseFloat(rawValue ?? '');
  if (!Number.isFinite(parsed)) {
    return DEFAULT_EFFECT_SPEED;
  }
  return Math.min(MAX_EFFECT_SPEED, Math.max(MIN_EFFECT_SPEED, parsed));
}

function parseVerticalAlign(rawValue: string | null): VerticalAlign {
  if (rawValue === 'middle' || rawValue === 'bottom') {
    return rawValue;
  }
  return 'top';
}

function parseHorizontalAlign(rawValue: string | null): HorizontalAlign {
  if (rawValue === 'middle' || rawValue === 'right') {
    return rawValue;
  }
  return 'left';
}

function toCrossAxisAlign(value: HorizontalAlign): 'flex-start' | 'center' | 'flex-end' {
  if (value === 'middle') {
    return 'center';
  }
  if (value === 'right') {
    return 'flex-end';
  }
  return 'flex-start';
}

function toMainAxisAlign(value: VerticalAlign): 'flex-start' | 'center' | 'flex-end' {
  if (value === 'middle') {
    return 'center';
  }
  if (value === 'bottom') {
    return 'flex-end';
  }
  return 'flex-start';
}

function toTextAlign(value: HorizontalAlign): 'left' | 'center' | 'right' {
  if (value === 'middle') {
    return 'center';
  }
  if (value === 'right') {
    return 'right';
  }
  return 'left';
}

function effectSpeedLabelFromValue(speed: number): EffectSpeedPreset {
  let closest: EffectSpeedOption = EFFECT_SPEED_OPTIONS[0];
  let closestDistance = Math.abs(speed - closest.value);

  for (let i = 1; i < EFFECT_SPEED_OPTIONS.length; i++) {
    const candidate = EFFECT_SPEED_OPTIONS[i];
    const distance = Math.abs(speed - candidate.value);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest.label;
}

function effectSpeedValueFromLabel(label: EffectSpeedPreset): number {
  const found = EFFECT_SPEED_OPTIONS.find((option) => option.label === label);
  return found?.value ?? DEFAULT_EFFECT_SPEED;
}

function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) + 1;
}

function hexToRgba(hexColor: string, alpha: number): string {
  const normalizedHex = hexColor.replace('#', '');
  const r = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const g = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const b = Number.parseInt(normalizedHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } {
  const normalizedHex = hexColor.replace('#', '');
  return {
    r: Number.parseInt(normalizedHex.slice(0, 2), 16),
    g: Number.parseInt(normalizedHex.slice(2, 4), 16),
    b: Number.parseInt(normalizedHex.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case nr:
        h = (ng - nb) / d + (ng < nb ? 6 : 0);
        break;
      case ng:
        h = (nb - nr) / d + 2;
        break;
      default:
        h = (nr - ng) / d + 4;
    }
    h *= 60;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hueToRgb = (p: number, q: number, t: number): number => {
    let nt = t;
    if (nt < 0) {
      nt += 1;
    }
    if (nt > 1) {
      nt -= 1;
    }
    if (nt < 1 / 6) {
      return p + (q - p) * 6 * nt;
    }
    if (nt < 1 / 2) {
      return q;
    }
    if (nt < 2 / 3) {
      return p + (q - p) * (2 / 3 - nt) * 6;
    }
    return p;
  };

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const normalizedHue = ((h % 360) + 360) % 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = normalizedHue / 360;

  return {
    r: Math.round(hueToRgb(p, q, hk + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hk) * 255),
    b: Math.round(hueToRgb(p, q, hk - 1 / 3) * 255),
  };
}

function rotateHexHue(hexColor: string, degrees: number): string {
  const { r, g, b } = hexToRgb(hexColor);
  const { h, s, l } = rgbToHsl(r, g, b);
  const nextHue = h + degrees;
  const rotated = hslToRgb(nextHue, s, l);
  return `rgb(${rotated.r}, ${rotated.g}, ${rotated.b})`;
}

function pickNextHueRotation(currentRotation = 0): number {
  const options = HIGHLIGHT_HUE_ROTATIONS.filter((rotation) => rotation !== currentRotation);
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex];
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
  const [replayRunId, setReplayRunId] = React.useState(0);
  const [isReplaying, setIsReplaying] = React.useState(false);
  const [isReplayButtonVisible, setIsReplayButtonVisible] = React.useState(false);
  const [typedText, setTypedText] = React.useState('');
  const [isTyping, setIsTyping] = React.useState(true);
  const [isCursorVisible, setIsCursorVisible] = React.useState(true);
  const [showEditHint, setShowEditHint] = React.useState(true);
  const [isEditHintVisible, setIsEditHintVisible] = React.useState(false);
  const [isEditHintFading, setIsEditHintFading] = React.useState(false);
  const [isTitleFlurryActive, setIsTitleFlurryActive] = React.useState(true);
  const [draftText, setDraftText] = React.useState('');
  const [draftEffect, setDraftEffect] = React.useState<PresentationEffect>('none');
  const [draftEffectSpeedLabel, setDraftEffectSpeedLabel] = React.useState<EffectSpeedPreset>('Medium');
  const [draftVerticalAlign, setDraftVerticalAlign] = React.useState<VerticalAlign>('top');
  const [draftHorizontalAlign, setDraftHorizontalAlign] = React.useState<HorizontalAlign>('left');
  const [boostedBoldKeys, setBoostedBoldKeys] = React.useState<Record<string, boolean>>({});
  const [highlightHueRotations, setHighlightHueRotations] = React.useState<Record<string, number>>({});
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const boldBoostTimeoutsRef = React.useRef<Map<string, number>>(new Map());
  const replayTimeoutRef = React.useRef<number | undefined>(undefined);
  const text = searchParams.get('text')?.trim() || 'Presentation playground';
  const effectParam = searchParams.get('effect');
  const effect: PresentationEffect = effectParam === 'typewriter' ? 'typewriter' : 'none';
  const isTypewriterEffect = effect === 'typewriter';
  const effectSpeed = parseEffectSpeed(searchParams.get('effectSpeed'));
  const verticalAlign = parseVerticalAlign(searchParams.get('valign'));
  const horizontalAlign = parseHorizontalAlign(searchParams.get('halign'));
  const markdownText = isReplaying
    ? ''
    : isTypewriterEffect
      ? `${typedText} _${TYPEWRITER_CARET_TOKEN}_`
      : text;

  React.useEffect(() => {
    if (isReplaying) {
      setTypedText('');
      setIsTyping(false);
      return;
    }

    if (!isTypewriterEffect) {
      setTypedText(text);
      setIsTyping(false);
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    setTypedText('');
    setIsTyping(true);

    const runTypewriter = (index: number) => {
      if (cancelled) {
        return;
      }

      if (index >= text.length) {
        setIsTyping(false);
        return;
      }

      setTypedText(text.slice(0, index + 1));

      const char = text[index];
      const isPauseChar = '.!?;:,\n'.includes(char);
      const baseDelay = 16 + Math.floor(Math.random() * 85);
      const pauseDelay = isPauseChar ? 80 + Math.floor(Math.random() * 160) : 0;
      const nextDelay = Math.max(8, Math.round((baseDelay + pauseDelay) / effectSpeed));
      timeoutId = window.setTimeout(() => runTypewriter(index + 1), nextDelay);
    };

    timeoutId = window.setTimeout(() => runTypewriter(0), 120);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [effectSpeed, isReplaying, isTypewriterEffect, replayRunId, text]);

  React.useEffect(() => {
    if (!isTypewriterEffect || isReplaying) {
      setIsCursorVisible(false);
      return;
    }

    setIsCursorVisible(true);
    const cursorInterval = window.setInterval(() => {
      setIsCursorVisible((current) => !current);
    }, 460);

    return () => {
      window.clearInterval(cursorInterval);
    };
  }, [isReplaying, isTypewriterEffect, replayRunId]);

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
    setIsTitleFlurryActive(true);
    const flurryTimeout = window.setTimeout(() => {
      setIsTitleFlurryActive(false);
    }, 2800);

    return () => {
      window.clearTimeout(flurryTimeout);
    };
  }, [replayRunId]);

  React.useEffect(() => {
    const timeoutMap = boldBoostTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeoutMap.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutMap.clear();
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (replayTimeoutRef.current !== undefined) {
        window.clearTimeout(replayTimeoutRef.current);
      }
    };
  }, []);

  const startEditing = React.useCallback(() => {
    setShowEditHint(false);
    setIsEditHintVisible(false);
    setIsEditHintFading(false);
    setDraftText(text);
    setDraftEffect(effect);
    setDraftEffectSpeedLabel(effectSpeedLabelFromValue(effectSpeed));
    setDraftVerticalAlign(verticalAlign);
    setDraftHorizontalAlign(horizontalAlign);
    setIsEditing(true);
  }, [effect, effectSpeed, horizontalAlign, text, verticalAlign]);

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
      if (draftEffect === 'typewriter') {
        nextParams.set('effect', 'typewriter');
        const normalizedEffectSpeed = effectSpeedValueFromLabel(draftEffectSpeedLabel).toString();
        nextParams.set('effectSpeed', normalizedEffectSpeed);
      } else {
        nextParams.delete('effect');
        nextParams.delete('effectSpeed');
      }
      if (draftVerticalAlign === 'top') {
        nextParams.delete('valign');
      } else {
        nextParams.set('valign', draftVerticalAlign);
      }
      if (draftHorizontalAlign === 'left') {
        nextParams.delete('halign');
      } else {
        nextParams.set('halign', draftHorizontalAlign);
      }
      setSearchParams(nextParams);
      setIsEditing(false);
    },
    [
      draftEffect,
      draftEffectSpeedLabel,
      draftHorizontalAlign,
      draftText,
      draftVerticalAlign,
      searchParams,
      setSearchParams,
    ]
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

  const handleMouseMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing || isReplaying) {
      setIsReplayButtonVisible(false);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const distanceFromRight = rect.right - event.clientX;
    const distanceFromBottom = rect.bottom - event.clientY;
    const isWithinCornerBounds =
      distanceFromRight >= 0 && distanceFromBottom >= 0 && distanceFromRight <= 180 && distanceFromBottom <= 180;
    const isWithinCornerRadius = Math.hypot(distanceFromRight, distanceFromBottom) <= 190;
    setIsReplayButtonVisible(isWithinCornerBounds && isWithinCornerRadius);
  }, [isEditing, isReplaying]);

  const handleReplay = React.useCallback(() => {
    if (isReplaying) {
      return;
    }

    if (replayTimeoutRef.current !== undefined) {
      window.clearTimeout(replayTimeoutRef.current);
    }

    setIsReplayButtonVisible(false);
    setIsReplaying(true);
    setTypedText('');
    setIsTyping(false);
    setIsCursorVisible(false);

    replayTimeoutRef.current = window.setTimeout(() => {
      setReplayRunId((current) => current + 1);
      setIsReplaying(false);
    }, 2000);
  }, [isReplaying]);

  return (
    <div
      className={styles.page}
      onDoubleClick={startEditing}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setIsReplayButtonVisible(false)}
    >
      <SparklesBackground className={styles.presentationLayer} withGradient />
      <div key={`content-${replayRunId}`} className={styles.centerText(verticalAlign, horizontalAlign)}>
        <MarkdownPreview
          markdown={markdownText}
          className={styles.markdownContent(horizontalAlign)}
          renderUnderline={(underlineText, key, index) => {
            const baseColor = AI_HIGHLIGHT_COLORS[index % AI_HIGHLIGHT_COLORS.length];
            const hueRotation = highlightHueRotations[key] ?? 0;
            const highlightColor = rotateHexHue(baseColor, hueRotation);
            return (
              <span
                key={key}
                className={styles.underlineHighlight(highlightColor)}
                onClick={() => {
                  setHighlightHueRotations((current) => {
                    const currentRotation = current[key] ?? 0;
                    const nextRotation = pickNextHueRotation(currentRotation);
                    return { ...current, [key]: nextRotation };
                  });
                }}
              >
                {underlineText}
              </span>
            );
          }}
          renderEm={(emText, key, index) => {
            if (emText === TYPEWRITER_CARET_TOKEN) {
              return (
                <span key={key} className={styles.typewriterCaret(isCursorVisible)} aria-hidden>
                  |
                </span>
              );
            }
            const baseColor = AI_HIGHLIGHT_COLORS[index % AI_HIGHLIGHT_COLORS.length];
            const hueRotation = highlightHueRotations[key] ?? 0;
            const highlightColor = rotateHexHue(baseColor, hueRotation);
            return (
              <em
                key={key}
                className={styles.emHighlight(highlightColor)}
                onClick={() => {
                  setHighlightHueRotations((current) => {
                    const currentRotation = current[key] ?? 0;
                    const nextRotation = pickNextHueRotation(currentRotation);
                    return { ...current, [key]: nextRotation };
                  });
                }}
              >
                {emText}
              </em>
            );
          }}
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
      {!isEditing && !isReplaying && (
        <button type="button" className={styles.replayButton(isReplayButtonVisible)} onClick={handleReplay} aria-label="Replay">
          <span className={styles.replayIcon} aria-hidden />
        </button>
      )}
      {isEditing && (
        <div className={styles.editPanelBackdrop}>
          <form
            className={styles.editPanel}
            onSubmit={handleSubmit}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div className={styles.editContent}>
              <div className={styles.editorColumn}>
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
              </div>
              <div className={styles.editSidebar}>
                <div className={styles.effectRow}>
                  <div className={styles.effectField}>
                    <label htmlFor="presentation-effect-editor" className={styles.effectLabel}>
                      Effect
                    </label>
                    <select
                      id="presentation-effect-editor"
                      className={styles.effectSelect}
                      value={draftEffect}
                      onChange={(event) => setDraftEffect(event.currentTarget.value as PresentationEffect)}
                    >
                      <option value="none">None</option>
                      <option value="typewriter">Typewriter</option>
                    </select>
                  </div>
                  <div className={styles.effectField}>
                    <label htmlFor="presentation-effect-speed-editor" className={styles.effectLabel}>
                      Speed
                    </label>
                    <select
                      id="presentation-effect-speed-editor"
                      className={styles.effectSpeedInput}
                      value={draftEffectSpeedLabel}
                      onChange={(event) => setDraftEffectSpeedLabel(event.currentTarget.value as EffectSpeedPreset)}
                      disabled={draftEffect !== 'typewriter'}
                    >
                      {EFFECT_SPEED_OPTIONS.map((option) => (
                        <option key={option.label} value={option.label}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className={styles.effectLabel} id="presentation-position-label">
                  Position
                </label>
                <div
                  className={styles.positionGrid}
                  role="radiogroup"
                  aria-labelledby="presentation-position-label"
                >
                  {POSITION_SEGMENTS.map((segment) => {
                    const isSelected =
                      draftVerticalAlign === segment.valign && draftHorizontalAlign === segment.halign;
                    return (
                      <button
                        key={segment.key}
                        type="button"
                        className={styles.positionSegment(isSelected)}
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={segment.label}
                        title={segment.label}
                        onClick={() => {
                          setDraftVerticalAlign(segment.valign);
                          setDraftHorizontalAlign(segment.halign);
                        }}
                      >
                        <span className={styles.positionSegmentDot(isSelected)} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  const markdownBlockSpacing = theme.spacing(6);

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
    centerText: (valign: VerticalAlign, halign: HorizontalAlign) =>
      css({
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: toCrossAxisAlign(halign),
        justifyContent: toMainAxisAlign(valign),
        textAlign: toTextAlign(halign),
        pointerEvents: 'none',
        padding: `${theme.spacing(8)} ${theme.spacing(10)} ${theme.spacing(6)}`,
        color: theme.colors.text.primary,
        fontSize: 'clamp(1.5rem, 2.8vw, 2.5rem)',
        lineHeight: 1.25,
        fontWeight: theme.typography.fontWeightMedium,
        textShadow: `0 12px 36px ${theme.colors.background.primary}`,
        wordBreak: 'break-word' as const,
      }),
    markdownContent: (halign: HorizontalAlign) =>
      css({
      width: '100%',
      maxWidth: '100%',
      margin: 0,
      transform: 'none',
      textAlign: toTextAlign(halign),
      color: theme.colors.text.primary,
      '& h1, & h2, & h3, & h4, & h5, & h6': {
        marginTop: 0,
        marginBottom: markdownBlockSpacing,
        fontFamily: '"Poppins", "Avenir Next", "Segoe UI", sans-serif',
        letterSpacing: '-0.02em',
        fontWeight: 700,
        color: theme.colors.primary.contrastText,
        textShadow: `0 0 14px ${theme.colors.primary.main}`,
      },
      '& h1': {
        fontSize: 'clamp(2rem, 5.2vw, 4.8rem)',
        lineHeight: 1.05,
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
        margin: `0 0 ${markdownBlockSpacing} 0`,
        maxWidth: 'none',
        fontSize: 'clamp(1.5rem, 2.9vw, 2.7rem)',
        lineHeight: 1.45,
        fontWeight: 600,
      },
      '& strong, & b': {
        fontWeight: 800,
        color: theme.colors.text.maxContrast,
      },
      '& ul, & ol': {
        margin: `0 0 ${markdownBlockSpacing} 0`,
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
        margin: `0 0 ${markdownBlockSpacing} 0`,
        maxWidth: '80vw',
        textAlign: toTextAlign(halign),
      },
    }),
    emHighlight: (highlightColor: string) =>
      css({
        fontStyle: 'normal',
        position: 'relative',
        zIndex: 0,
        pointerEvents: 'auto',
        cursor: 'pointer',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: '-0.2em',
          right: '-0.2em',
          top: '-0.14em',
          bottom: '-0.12em',
          borderRadius: theme.shape.radius.default,
          background: `linear-gradient(174deg, ${hexToRgba(highlightColor, 0.28)} 0%, ${hexToRgba(highlightColor, 0.18)} 100%)`,
          transform: 'rotate(-0.8deg)',
          zIndex: -1,
          pointerEvents: 'none',
        },
      }),
    underlineHighlight: (highlightColor: string) =>
      css({
        position: 'relative',
        zIndex: 0,
        pointerEvents: 'auto',
        cursor: 'pointer',
        textDecorationLine: 'underline',
        textDecorationThickness: '0.08em',
        textUnderlineOffset: '0.1em',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: '-0.3em',
          right: '-0.3em',
          top: '-0.2em',
          bottom: '-0.18em',
          borderRadius: theme.shape.radius.default,
          background: `linear-gradient(174deg, ${hexToRgba(highlightColor, 0.22)} 0%, ${hexToRgba(highlightColor, 0.12)} 100%)`,
          transform: 'rotate(-0.8deg)',
          zIndex: -1,
          pointerEvents: 'none',
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
      padding: theme.spacing(2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z3,
      minHeight: 360,
    }),
    editContent: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 220px',
      gap: theme.spacing(2),
      alignItems: 'stretch',
      minHeight: 0,
      flex: 1,
    }),
    editSidebar: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      borderLeft: `1px solid ${theme.colors.border.weak}`,
      paddingLeft: theme.spacing(2),
      minHeight: '100%',
    }),
    effectRow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: theme.spacing(1),
      alignItems: 'end',
    }),
    effectField: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      minWidth: 0,
    }),
    editorColumn: css({
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      gap: theme.spacing(1.5),
    }),
    textarea: css({
      width: '100%',
      height: '100%',
      minHeight: 260,
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
    effectLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
    }),
    effectSelect: css({
      width: '100%',
      minHeight: theme.spacing(4.5),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.canvas,
      color: theme.colors.text.primary,
      padding: `0 ${theme.spacing(1)}`,
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: '1.2',
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: 1,
      },
    }),
    effectSpeedInput: css({
      width: '100%',
      minHeight: theme.spacing(4.5),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.canvas,
      color: theme.colors.text.primary,
      padding: `0 ${theme.spacing(1)}`,
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: '1.2',
      '&:focus': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: 1,
      },
      '&:disabled': {
        opacity: 0.6,
        cursor: 'not-allowed',
      },
    }),
    positionGrid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: theme.spacing(0.75),
      padding: theme.spacing(0.5),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.canvas,
    }),
    positionSegment: (isSelected: boolean) =>
      css({
        minHeight: theme.spacing(4),
        borderRadius: theme.shape.radius.default,
        border: `1px solid ${isSelected ? theme.colors.primary.main : theme.colors.border.weak}`,
        background: isSelected ? theme.colors.primary.transparent : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        transition: 'border-color 150ms ease, background-color 150ms ease',
        '&:focus-visible': {
          outline: `2px solid ${theme.colors.primary.main}`,
          outlineOffset: 1,
        },
      }),
    positionSegmentDot: (isSelected: boolean) =>
      css({
        width: theme.spacing(1),
        height: theme.spacing(1),
        borderRadius: '50%',
        background: isSelected ? theme.colors.primary.text : theme.colors.text.secondary,
        opacity: isSelected ? 1 : 0.6,
      }),
    actions: css({
      display: 'flex',
      justifyContent: 'flex-end',
      gap: theme.spacing(1),
      marginTop: 'auto',
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
    replayButton: (isVisible: boolean) =>
      css({
        position: 'absolute',
        right: theme.spacing(3),
        bottom: theme.spacing(3),
        zIndex: 3,
        width: 'auto',
        height: 'auto',
        border: 'none',
        background: 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.colors.text.primary,
        cursor: 'pointer',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 220ms ease, transform 220ms ease',
        pointerEvents: isVisible ? 'auto' : 'none',
        '&:focus-visible': {
          outline: `2px solid ${theme.colors.primary.main}`,
          outlineOffset: 2,
        },
      }),
    replayIcon: css({
      width: 0,
      height: 0,
      borderTop: '7px solid transparent',
      borderBottom: '7px solid transparent',
      borderLeft: `12px solid currentColor`,
      marginLeft: '2px',
    }),
    typewriterCaret: (isVisible: boolean) =>
      css({
        display: 'inline-block',
        width: '0.38em',
        marginLeft: '0.15em',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 140ms linear',
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
