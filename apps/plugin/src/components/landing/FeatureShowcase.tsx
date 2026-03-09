import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../../constants';
import agentsScreenshot from '../../img/landing/agents.png';
import analyticsScreenshot from '../../img/landing/analytics.png';
import conversationsScreenshot from '../../img/landing/conversations.png';
import drilldownScreenshot from '../../img/landing/drilldown.png';
import evaluationsScreenshot from '../../img/landing/evaluations.png';
import promptsScreenshot from '../../img/landing/prompts.png';

type Feature = {
  key: string;
  title: string;
  description: string;
  color: string;
  href: string;
  icon: React.ReactNode;
  screenshotSrc?: string;
};

const FEATURES: Feature[] = [
  {
    key: 'analytics',
    title: 'Analytics',
    description: 'Requests, tokens, cost, and latency.',
    color: '#5794F2',
    href: `${PLUGIN_BASE}/${ROUTES.Analytics}`,
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="12" width="4" height="9" rx="0.5" />
        <rect x="10" y="5" width="4" height="16" rx="0.5" />
        <rect x="17" y="8" width="4" height="13" rx="0.5" />
      </svg>
    ),
    screenshotSrc: analyticsScreenshot,
  },
  {
    key: 'evaluations',
    title: 'Online Evaluations',
    description: 'LLM judges, regex, and heuristics.',
    color: '#FF9830',
    href: `${PLUGIN_BASE}/${ROUTES.Evaluation}/results`,
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    screenshotSrc: evaluationsScreenshot,
  },
  {
    key: 'prompts',
    title: 'Prompt Analysis',
    description: 'Prompt chains and quality insights.',
    color: '#B877D9',
    href: `${PLUGIN_BASE}/${ROUTES.Conversations}`,
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    screenshotSrc: promptsScreenshot,
  },
  {
    key: 'drilldown',
    title: 'Conversation Drilldown',
    description: 'Flows, tool calls, and traces.',
    color: '#73BF69',
    href: `${PLUGIN_BASE}/${ROUTES.Conversations}`,
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    screenshotSrc: drilldownScreenshot,
  },
  {
    key: 'agents',
    title: 'Agent Catalog',
    description: 'Versions, prompt diffs, quality.',
    color: '#F2495C',
    href: `${PLUGIN_BASE}/${ROUTES.Agents}`,
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    screenshotSrc: agentsScreenshot,
  },
  {
    key: 'conversations',
    title: 'Conversation Explorer',
    description: 'Search and filter AI threads.',
    color: '#FF6EB4',
    href: `${PLUGIN_BASE}/${ROUTES.Conversations}`,
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
    screenshotSrc: conversationsScreenshot,
  },
];

const INTRO_INDEX = -2;
const OVERVIEW_INDEX = -1;
const CYCLE_MS = 4000;
const OVERVIEW_CYCLE_MS = 6000;
const INTRO_CYCLE_MS = 3000;

export function FeatureShowcase() {
  const styles = useStyles2(getStyles);
  const [activeIndex, setActiveIndex] = useState(INTRO_INDEX);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);

  const startTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
    }
    const currentMs =
      activeIndex === INTRO_INDEX ? INTRO_CYCLE_MS : activeIndex === OVERVIEW_INDEX ? OVERVIEW_CYCLE_MS : CYCLE_MS;
    timerRef.current = setInterval(() => {
      if (!pausedRef.current) {
        setActiveIndex((prev) => {
          if (prev === INTRO_INDEX) {
            return OVERVIEW_INDEX;
          }
          const next = prev + 1;
          return next >= FEATURES.length ? OVERVIEW_INDEX : next;
        });
      }
    }, currentMs);
  }, [activeIndex]);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
      }
    };
  }, [startTimer]);

  const selectFeature = (index: number) => {
    if (index === OVERVIEW_INDEX) {
      setActiveIndex(INTRO_INDEX);
    } else {
      setActiveIndex(index);
    }
  };

  const isIntro = activeIndex === INTRO_INDEX;
  const isOverview = activeIndex === OVERVIEW_INDEX;
  const active = isIntro || isOverview ? null : FEATURES[activeIndex];

  return (
    <div
      className={styles.container}
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
    >
      <div className={styles.slideBody}>
        {isIntro ? (
          <div className={styles.introSlide}>
            <div className={styles.introGradientBg} />
            <div className={styles.introGlow} />
            <div className={styles.introOrbs}>
              <div
                className={styles.introOrb}
                style={{
                  width: 120,
                  height: 120,
                  top: '10%',
                  left: '15%',
                  background: 'radial-gradient(circle, #5794F230 0%, transparent 70%)',
                  animationDuration: '7s',
                  animationDelay: '0s',
                }}
              />
              <div
                className={styles.introOrb}
                style={{
                  width: 90,
                  height: 90,
                  top: '60%',
                  left: '70%',
                  background: 'radial-gradient(circle, #B877D930 0%, transparent 70%)',
                  animationDuration: '9s',
                  animationDelay: '1s',
                }}
              />
              <div
                className={styles.introOrb}
                style={{
                  width: 60,
                  height: 60,
                  top: '30%',
                  left: '80%',
                  background: 'radial-gradient(circle, #5794F225 0%, transparent 70%)',
                  animationDuration: '6s',
                  animationDelay: '0.5s',
                }}
              />
              <div
                className={styles.introOrb}
                style={{
                  width: 140,
                  height: 140,
                  top: '55%',
                  left: '5%',
                  background: 'radial-gradient(circle, #8B5CF625 0%, transparent 70%)',
                  animationDuration: '11s',
                  animationDelay: '2s',
                }}
              />
              <div
                className={styles.introOrb}
                style={{
                  width: 50,
                  height: 50,
                  top: '15%',
                  left: '55%',
                  background: 'radial-gradient(circle, #6C5CE720 0%, transparent 70%)',
                  animationDuration: '8s',
                  animationDelay: '3s',
                }}
              />
            </div>
            <div className={styles.introContent}>
              <span className={styles.introTitle}>Grafana Sigil</span>
              <span className={styles.introTagline}>AI Observability for every LLM call</span>
              <span className={styles.introSubtag}>
                Instrument, observe, and evaluate — with <span style={{ color: '#FF9830' }}>Grafana</span>
              </span>
            </div>
          </div>
        ) : isOverview ? (
          <div className={styles.overviewSlide}>
            <div className={styles.introGradientBg} />
            <div className={styles.introOrbs}>
              <div
                className={styles.introOrb}
                style={{
                  width: 100,
                  height: 100,
                  top: '5%',
                  left: '60%',
                  background: 'radial-gradient(circle, #5794F220 0%, transparent 70%)',
                  animationDuration: '8s',
                  animationDelay: '0s',
                }}
              />
              <div
                className={styles.introOrb}
                style={{
                  width: 80,
                  height: 80,
                  top: '65%',
                  left: '10%',
                  background: 'radial-gradient(circle, #B877D920 0%, transparent 70%)',
                  animationDuration: '10s',
                  animationDelay: '1.5s',
                }}
              />
              <div
                className={styles.introOrb}
                style={{
                  width: 60,
                  height: 60,
                  top: '20%',
                  left: '85%',
                  background: 'radial-gradient(circle, #8B5CF618 0%, transparent 70%)',
                  animationDuration: '7s',
                  animationDelay: '0.5s',
                }}
              />
            </div>
            <div className={styles.overviewGradientBar} />
            <div className={styles.overviewContent}>
              <Text variant="h5">App Features</Text>
              <div className={styles.overviewGrid}>
                {FEATURES.map((feature, i) => (
                  <button
                    key={feature.key}
                    type="button"
                    className={styles.overviewItem}
                    onClick={() => selectFeature(i)}
                    style={{ animationDelay: `${i * 0.06}s` }}
                  >
                    <div
                      className={styles.overviewItemIcon}
                      style={{ color: feature.color, background: `${feature.color}14` }}
                    >
                      {feature.icon}
                    </div>
                    <span className={styles.overviewItemTitle} style={{ color: feature.color }}>
                      {feature.title}
                    </span>
                    <span className={styles.overviewItemDesc}>{feature.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <a href={active!.href} className={styles.previewLink}>
            <div className={styles.previewHeader}>
              <div className={styles.previewAccent} style={{ background: active!.color }} />
              <div className={styles.previewText}>
                <Text variant="h5">{active!.title}</Text>
                <Text variant="bodySmall" color="secondary">
                  {active!.description}
                </Text>
              </div>
            </div>
            <div className={styles.preview}>
              {active!.screenshotSrc ? (
                <img src={active!.screenshotSrc} alt={active!.title} className={styles.previewImage} />
              ) : (
                <div className={styles.previewPlaceholder}>
                  <div
                    className={styles.previewIcon}
                    style={{ color: active!.color, background: `${active!.color}18` }}
                  >
                    {active!.icon}
                  </div>
                </div>
              )}
            </div>
          </a>
        )}
      </div>

      <div className={styles.tabs}>
        {(() => {
          const overviewActive = isOverview || isIntro;
          const overviewColor = '#CCCCDC';
          const allTabs = [
            {
              key: 'overview',
              label: 'Overview',
              color: overviewColor,
              index: OVERVIEW_INDEX,
              isActive: overviewActive,
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              ),
            },
            ...FEATURES.map((f, i) => ({
              key: f.key,
              label: f.title,
              color: f.color,
              index: i,
              isActive: i === activeIndex,
              icon: f.icon,
            })),
          ];
          return allTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={styles.tab}
              onClick={() => selectFeature(t.index)}
              aria-label={t.label}
              aria-current={t.isActive ? 'true' : undefined}
            >
              <div className={styles.tabIcon} style={{ color: t.isActive ? t.color : undefined }}>
                {t.icon}
              </div>
              <span className={styles.tabLabel} style={{ color: t.isActive ? t.color : undefined }}>
                {t.label}
              </span>
            </button>
          ));
        })()}
      </div>
    </div>
  );
}

const gradientShift = keyframes({
  '0%': { backgroundPosition: '0% 50%' },
  '50%': { backgroundPosition: '100% 50%' },
  '100%': { backgroundPosition: '0% 50%' },
});

const fadeInUp = keyframes({
  from: { opacity: 0, transform: 'translateY(12px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const orbFloat = keyframes({
  '0%': { transform: 'translate(0, 0) scale(1)' },
  '25%': { transform: 'translate(30px, -20px) scale(1.1)' },
  '50%': { transform: 'translate(-10px, -40px) scale(0.95)' },
  '75%': { transform: 'translate(-30px, -10px) scale(1.05)' },
  '100%': { transform: 'translate(0, 0) scale(1)' },
});

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      label: 'featureShowcase-container',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      width: '100%',
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      background: theme.colors.background.secondary,
      transition: 'border-color 0.2s ease',
      '&:hover': {
        borderColor: theme.colors.border.medium,
      },
    }),

    slideBody: css({
      label: 'featureShowcase-slideBody',
      display: 'flex',
      flexDirection: 'column',
      aspectRatio: '2.4',
      overflow: 'hidden',
    }),
    introSlide: css({
      label: 'featureShowcase-introSlide',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
    }),
    introGradientBg: css({
      label: 'featureShowcase-introGradientBg',
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(135deg, #5794F235 0%, #6C5CE730 25%, #B877D935 50%, #5794F225 75%, #8B5CF630 100%)',
      backgroundSize: '400% 400%',
      animation: `${gradientShift} 10s ease infinite`,
    }),
    introGlow: css({
      label: 'featureShowcase-introGlow',
      position: 'absolute',
      top: '-40%',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '120%',
      height: '60%',
      background: 'radial-gradient(ellipse, #5794F230 0%, #B877D920 40%, transparent 70%)',
      pointerEvents: 'none',
    }),
    introOrbs: css({
      label: 'featureShowcase-introOrbs',
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      overflow: 'hidden',
    }),
    introOrb: css({
      label: 'featureShowcase-introOrb',
      position: 'absolute',
      borderRadius: '50%',
      filter: 'blur(20px)',
      animation: `${orbFloat} linear infinite`,
    }),
    introContent: css({
      label: 'featureShowcase-introContent',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(0.75),
      flex: 1,
      padding: theme.spacing(2),
      textAlign: 'center',
    }),
    introTitle: css({
      label: 'featureShowcase-introTitle',
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: '-0.02em',
      background: 'linear-gradient(135deg, #5794F2 0%, #B877D9 50%, #FF9830 100%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    }),
    introTagline: css({
      label: 'featureShowcase-introTagline',
      fontSize: theme.typography.h5.fontSize,
      fontWeight: 500,
      color: theme.colors.text.primary,
      animation: `${fadeInUp} 0.5s ease-out 0.1s both`,
    }),
    introSubtag: css({
      label: 'featureShowcase-introSubtag',
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
      animation: `${fadeInUp} 0.5s ease-out 0.15s both`,
    }),
    overviewSlide: css({
      label: 'featureShowcase-overviewSlide',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
    }),
    overviewGradientBar: css({
      label: 'featureShowcase-overviewGradientBar',
      height: 2,
      width: '100%',
      flexShrink: 0,
      background: 'linear-gradient(90deg, #5794F2 0%, #B877D9 50%, #FF9830 100%)',
      position: 'relative',
      zIndex: 1,
    }),
    overviewContent: css({
      label: 'featureShowcase-overviewContent',
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.75),
      padding: theme.spacing(1),
      flex: 1,
      minHeight: 0,
    }),
    overviewGrid: css({
      label: 'featureShowcase-overviewGrid',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: '1fr 1fr',
      gap: theme.spacing(0.75),
      flex: 1,
      minHeight: 0,
    }),
    overviewItem: css({
      label: 'featureShowcase-overviewItem',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.25),
      padding: theme.spacing(0.75),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: `${theme.colors.background.primary}dd`,
      backdropFilter: 'blur(8px)',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
      flex: 1,
      animation: `${fadeInUp} 0.4s ease-out both`,
      '&:hover': {
        borderColor: theme.colors.border.medium,
        boxShadow: theme.shadows.z1,
        transform: 'translateY(-1px)',
      },
    }),
    overviewItemIcon: css({
      label: 'featureShowcase-overviewItemIcon',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      width: 24,
      height: 24,
      borderRadius: theme.shape.radius.default,
      '& svg': {
        width: 13,
        height: 13,
      },
    }),
    overviewItemTitle: css({
      label: 'featureShowcase-overviewItemTitle',
      fontSize: 12,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1.2,
    }),
    overviewItemDesc: css({
      label: 'featureShowcase-overviewItemDesc',
      fontSize: 11,
      lineHeight: 1.3,
      color: theme.colors.text.secondary,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    }),

    previewLink: css({
      label: 'featureShowcase-previewLink',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      textDecoration: 'none',
      color: 'inherit',
      '&:hover': {
        textDecoration: 'none',
        color: 'inherit',
      },
    }),
    previewHeader: css({
      label: 'featureShowcase-previewHeader',
      flexShrink: 0,
    }),
    previewAccent: css({
      label: 'featureShowcase-previewAccent',
      height: 2,
      width: '100%',
    }),
    previewText: css({
      label: 'featureShowcase-previewText',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      padding: theme.spacing(0.5, 1),
    }),
    preview: css({
      label: 'featureShowcase-preview',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
    }),
    previewImage: css({
      label: 'featureShowcase-previewImage',
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: 'top left',
    }),
    previewPlaceholder: css({
      label: 'featureShowcase-previewPlaceholder',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
    }),
    previewIcon: css({
      label: 'featureShowcase-previewIcon',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 56,
      height: 56,
      borderRadius: theme.shape.radius.circle,
      transition: 'transform 0.3s ease',
      '& svg': {
        width: 28,
        height: 28,
      },
    }),

    tabs: css({
      label: 'featureShowcase-tabs',
      display: 'flex',
      gap: 3,
      padding: theme.spacing(0.25),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    tab: css({
      label: 'featureShowcase-tab',
      position: 'relative',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      padding: theme.spacing(0.25, 0.25),
      background: 'transparent',
      border: 'none',
      borderRadius: theme.shape.radius.default,
      cursor: 'pointer',
      color: theme.colors.text.secondary,
      minWidth: 0,
      transition: 'background 0.15s ease, color 0.15s ease',
      '&:hover': {
        background: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
      '&[aria-current="true"]': {
        color: theme.colors.text.primary,
      },
    }),
    tabIcon: css({
      label: 'featureShowcase-tabIcon',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'color 0.2s ease',
      '& svg': {
        width: 12,
        height: 12,
      },
    }),
    tabLabel: css({
      label: 'featureShowcase-tabLabel',
      fontSize: 8,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1.2,
      letterSpacing: '0.01em',
      textAlign: 'center',
      maxWidth: 48,
      transition: 'color 0.2s ease',
    }),
  };
}
