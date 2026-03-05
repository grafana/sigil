import React, { useEffect, useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { useAssistant } from '@grafana/assistant';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { TryItNowPanel } from '../components/tutorial/TryItNowPanel';
import { PLUGIN_BASE, ROUTES } from '../constants';

type TutorialSlide = {
  slug: string;
  title: string;
  subtitle: string;
  subtitleBadge?: string;
  renderGraphic: (props: SlideGraphicProps) => React.ReactNode;
  body: React.ReactNode;
};

type SignalField = {
  name: string;
  type: string;
  description: string;
  details: string;
};

type SignalFieldGroup = {
  title: string;
  subtitle: string;
  fields: SignalField[];
};

type SlideGraphicProps = {
  accentColor: string;
  secondaryColor: string;
  backgroundClassName: string;
  foregroundClassName: string;
};

const SIGNAL_FIELD_GROUPS: SignalFieldGroup[] = [
  {
    title: 'Correlation and identity',
    subtitle: 'Tie each event back to the exact request, operation, and generation chain.',
    fields: [
      {
        name: 'trace_id',
        type: 'string',
        description: 'Groups related spans and generations into one request trace.',
        details: 'Top-level correlation key across app logs, traces, and Sigil.',
      },
      {
        name: 'span_id',
        type: 'string',
        description: 'Identifies the span that emitted this generation event.',
        details: 'Maps telemetry back to a specific operation in a trace.',
      },
      {
        name: 'generation_id',
        type: 'string',
        description: 'Unique ID for this generation record.',
        details: 'Primary lookup key for drilldowns and cross-linking.',
      },
      {
        name: 'parent_generation_id',
        type: 'string | null',
        description: 'Links this generation to an upstream parent generation.',
        details: 'Reconstructs chains like planner -> tool -> follow-up.',
      },
    ],
  },
  {
    title: 'Model execution context',
    subtitle: 'Capture where and how the model ran so you can compare behavior reliably.',
    fields: [
      {
        name: 'timestamp',
        type: 'RFC3339 timestamp',
        description: 'Capture time for the generation event.',
        details: 'Used for filtering, ordering, and incident timeline alignment.',
      },
      {
        name: 'provider',
        type: 'openai | anthropic | ...',
        description: 'LLM provider handling the request.',
        details: 'Compare reliability, latency, and cost by provider.',
      },
      {
        name: 'model',
        type: 'string',
        description: 'Specific model name used for generation.',
        details: 'Spot regressions when model versions or routing changes.',
      },
      {
        name: 'mode',
        type: 'SYNC | STREAM',
        description: 'Whether output arrived as one response or streamed chunks.',
        details: 'Explains latency and token delivery behavior differences.',
      },
    ],
  },
  {
    title: 'Consumption and performance',
    subtitle: 'Track latency and token usage to manage user experience and spend.',
    fields: [
      {
        name: 'input_tokens',
        type: 'number',
        description: 'Prompt-side token count.',
        details: 'Tracks prompt growth and expensive context assembly.',
      },
      {
        name: 'output_tokens',
        type: 'number',
        description: 'Completion-side token count.',
        details: 'Watch verbosity drift, truncation, and cost pressure.',
      },
      {
        name: 'latency_ms',
        type: 'number',
        description: 'End-to-end generation latency in milliseconds.',
        details: 'High-signal SLO metric for UX and agent productivity.',
      },
      {
        name: 'cost_usd',
        type: 'number',
        description: 'Estimated per-generation cost in USD.',
        details: 'Supports cost attribution by team, agent, model, and feature.',
      },
    ],
  },
  {
    title: 'Outcome and business context',
    subtitle: 'Understand whether generations succeeded and which product slice they belong to.',
    fields: [
      {
        name: 'status',
        type: 'ok | error',
        description: 'Outcome classification for this generation.',
        details: 'Filter and alert quickly on failing paths.',
      },
      {
        name: 'agent_name',
        type: 'string',
        description: 'Logical agent/service that triggered the generation.',
        details: 'Compare behavior across assistants and background workers.',
      },
      {
        name: 'labels',
        type: '{ "key": "value" }',
        description: 'Custom dimensions for business and runtime context.',
        details: 'Add metadata like tenant, environment, or experiment arm.',
      },
    ],
  },
];

const TUTORIAL_SLIDES: TutorialSlide[] = [
  {
    slug: 'what-is-sigil',
    title: 'What is Sigil?',
    subtitle: 'Observability purpose-built for LLM applications',
    renderGraphic: (props) => <WhatIsSigilGraphic {...props} />,
    body: (
      <ul>
        <li>Know when your agents break, slow down, or cost too much.</li>
        <li>Open spec built on OpenTelemetry. No vendor lock-in.</li>
        <li>Purpose-built storage and UX for generation telemetry.</li>
      </ul>
    ),
  },
  {
    slug: 'about-the-database',
    title: 'New OSS database',
    subtitle: 'Not a trace store. A generation store.',
    renderGraphic: (props) => <DatabaseGraphic {...props} />,
    body: (
      <ul>
        <li>Schema designed around generation events, not retrofitted spans.</li>
        <li>Fast queries across time, model, agent, and custom labels.</li>
        <li>Stays responsive at high cardinality and large volumes.</li>
        <li>One store powers both dashboards and deep investigations.</li>
      </ul>
    ),
  },
  {
    slug: 'ui-features',
    title: 'Actually useful UX',
    subtitle: "See what matters. Drill into what doesn't look right.",
    renderGraphic: (props) => <UiFeaturesGraphic {...props} />,
    body: (
      <ul>
        <li>Spot regressions, errors, and cost spikes at a glance.</li>
        <li>Filter by provider, model, agent, or any custom label.</li>
        <li>Explore conversations as a timeline with full context.</li>
        <li>Evaluate agent performance and tighten tuning loops.</li>
      </ul>
    ),
  },
  {
    slug: 'about-the-telemetry-signal',
    title: 'A modern signal for modern software',
    subtitle: 'Generation-first telemetry for LLM applications',
    subtitleBadge: 'Sigil Spec v0.1',
    renderGraphic: (props) => <TelemetrySignalGraphic {...props} />,
    body: (
      <>
        <p>Every LLM call becomes a structured event. Quality, latency, cost, and failures in one schema, one place.</p>
        <SignalFieldMosaic groups={SIGNAL_FIELD_GROUPS} />
      </>
    ),
  },
  {
    slug: 'autoinstrumentation',
    title: 'Autoinstrumentation',
    subtitle: 'From zero to instrumented in minutes, not days.',
    renderGraphic: (props) => <AutoinstrumentationGraphic {...props} />,
    body: <AutoinstrumentationBody />,
  },
  {
    slug: 'next-steps',
    title: 'Next steps',
    subtitle: 'Start instrumenting. The data speaks for itself.',
    renderGraphic: (props) => <NextStepsGraphic {...props} />,
    body: <NextStepsBody />,
  },
];

const TUTORIAL_COLORS = ['#5794F2', '#8A7DEE', '#B877D9', '#DA7AAF', '#F28B4E', '#FF9830'];

function getTutorialColor(_total: number, index: number): string {
  const i = Math.min(Math.max(Math.round(index), 0), TUTORIAL_COLORS.length - 1);
  return TUTORIAL_COLORS[i];
}

const TUTORIAL_SLUGS = new Set(TUTORIAL_SLIDES.map((slide) => slide.slug));

const TYPEWRITER_MS_PER_CHAR = 28;

function TypewriterSubtitle({ text, className }: { text: string; className: string }) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      queueMicrotask(() => setDisplayed(text));
      return;
    }
    queueMicrotask(() => setDisplayed(''));
    let i = 0;
    const id = setInterval(() => {
      if (i >= text.length) {
        clearInterval(id);
        return;
      }
      setDisplayed(text.slice(0, i + 1));
      i += 1;
    }, TYPEWRITER_MS_PER_CHAR);
    return () => clearInterval(id);
  }, [text]);

  return <p className={className}>{displayed}</p>;
}

function getTutorialBasePath(pathname: string): string {
  const marker = `/${ROUTES.Tutorial}`;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) {
    return marker;
  }

  return pathname.slice(0, markerIndex + marker.length);
}

function getSlidePath(index: number, basePath: string): string {
  const slide = TUTORIAL_SLIDES[index];
  if (!slide || index === 0) {
    return basePath;
  }

  return `${basePath}/${slide.slug}`;
}

function getClosePath(tutorialBasePath: string): string {
  const tutorialSuffix = `/${ROUTES.Tutorial}`;
  if (!tutorialBasePath.endsWith(tutorialSuffix)) {
    return tutorialBasePath;
  }

  const appBasePath = tutorialBasePath.slice(0, -tutorialSuffix.length);
  return appBasePath.length > 0 ? appBasePath : '/';
}

export default function TutorialPage() {
  const styles = useStyles2(getStyles);
  const location = useLocation();
  const tutorialBasePath = getTutorialBasePath(location.pathname);
  const closePath = getClosePath(tutorialBasePath);
  const wildcard = useParams()['*'] ?? '';
  const requestedSlug = wildcard.split('/')[0];
  const hasRequestedSlug = requestedSlug.length > 0;

  if (hasRequestedSlug && !TUTORIAL_SLUGS.has(requestedSlug)) {
    return <Navigate to={getSlidePath(0, tutorialBasePath)} replace />;
  }

  const currentIndex = hasRequestedSlug ? TUTORIAL_SLIDES.findIndex((slide) => slide.slug === requestedSlug) : 0;
  const slide = TUTORIAL_SLIDES[currentIndex];
  const slideAccentColor = getTutorialColor(TUTORIAL_SLIDES.length, currentIndex);
  const slideSecondaryColor = getTutorialColor(TUTORIAL_SLIDES.length, currentIndex + 2);
  const previousIndex = currentIndex > 0 ? currentIndex - 1 : null;
  const nextIndex = currentIndex < TUTORIAL_SLIDES.length - 1 ? currentIndex + 1 : null;
  const cardStyle = {
    '--tutorial-accent': slideAccentColor,
    '--tutorial-secondary': slideSecondaryColor,
  } as React.CSSProperties;

  return (
    <div className={styles.page}>
      <article className={styles.card} style={cardStyle}>
        <header className={styles.topBar}>
          <h1 className={styles.title}>{slide.title}</h1>
          <nav className={styles.navigation} aria-label="Tutorial navigation">
            {previousIndex !== null ? (
              <Link
                to={getSlidePath(previousIndex, tutorialBasePath)}
                className={styles.arrowButton}
                aria-label="Previous page"
              >
                {'<'}
              </Link>
            ) : (
              <span className={cx(styles.arrowButton, styles.arrowButtonDisabled)} aria-hidden>
                {'<'}
              </span>
            )}
            <div className={styles.dotList}>
              {TUTORIAL_SLIDES.map((tutorialSlide, index) => (
                <Link
                  key={tutorialSlide.slug}
                  to={getSlidePath(index, tutorialBasePath)}
                  className={cx(styles.dot, index === currentIndex && styles.dotActive)}
                  aria-label={`Go to ${tutorialSlide.title}`}
                  aria-current={index === currentIndex ? 'page' : undefined}
                />
              ))}
            </div>
            {nextIndex !== null ? (
              <Link
                to={getSlidePath(nextIndex, tutorialBasePath)}
                className={styles.arrowButton}
                aria-label="Next page"
              >
                {'>'}
              </Link>
            ) : (
              <span className={cx(styles.arrowButton, styles.arrowButtonDisabled)} aria-hidden>
                {'>'}
              </span>
            )}
          </nav>
          <Link to={closePath} className={styles.closeButton} aria-label="Close tutorial">
            X
          </Link>
        </header>
        <div className={styles.content}>
          <div className={styles.slideLayout}>
            <div className={styles.textContent}>
              <TypewriterSubtitle text={slide.subtitle} className={styles.subtitle} key={currentIndex} />
              {slide.subtitleBadge ? <p className={styles.subtitleBadge}>{slide.subtitleBadge}</p> : null}
              <div className={styles.body}>{slide.body}</div>
              {nextIndex !== null ? (
                <div className={styles.contentFooter}>
                  <Link to={getSlidePath(nextIndex, tutorialBasePath)} className={styles.nextLink}>
                    Next →
                  </Link>
                </div>
              ) : null}
            </div>
            <div className={styles.graphicFrame} aria-hidden>
              {slide.renderGraphic({
                accentColor: slideAccentColor,
                secondaryColor: slideSecondaryColor,
                backgroundClassName: styles.graphicBackgroundLayer,
                foregroundClassName: styles.graphicForegroundLayer,
              })}
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

function AutoinstrumentationBody() {
  return (
    <>
      <ul>
        <li>AI-powered tools that add instrumentation for you.</li>
        <li>An interactive agent that asks what it needs as it goes.</li>
        <li>Works for greenfield and existing codebases alike.</li>
        <li>See results immediately in the Sigil UI.</li>
      </ul>
      <TryItNowPanel />
    </>
  );
}

const ASSISTANT_ORIGIN_TUTORIAL = 'grafana/sigil-plugin/tutorial';

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}

function NextStepsBody() {
  const styles = useStyles2(getStyles);
  const location = useLocation();
  const assistant = useAssistant();
  const tutorialBasePath = getTutorialBasePath(location.pathname);
  const appBasePath = getClosePath(tutorialBasePath);
  const base = appBasePath === '/' ? PLUGIN_BASE : appBasePath;

  const links = [
    { label: 'Drill into Conversations', route: ROUTES.Conversations },
    { label: 'Monitor agents', route: ROUTES.Agents },
    { label: 'Evaluate performance', route: ROUTES.Evaluation },
  ] as const;

  const openAssistant = () => {
    const prompt = 'What is Sigil and how can I get started?';
    if (assistant.openAssistant) {
      assistant.openAssistant({
        origin: ASSISTANT_ORIGIN_TUTORIAL,
        prompt,
        autoSend: true,
      });
    } else {
      window.location.href = buildAssistantUrl(prompt);
    }
  };

  return (
    <>
      <ul>
        <li>Explore the docs to go deeper.</li>
        <li>Use Cursor to instrument your own codebase.</li>
        <li>
          <button type="button" className={styles.askAssistantLink} onClick={openAssistant}>
            Ask Assistant about Sigil →
          </button>
        </li>
      </ul>
      <section className={styles.whereToGoNext}>
        <h4 className={styles.whereToGoNextHeading}>Where to explore next</h4>
        <ul className={styles.whereToGoNextList}>
          {links.map(({ label, route }) => (
            <li key={route}>
              <Link to={`${base}/${route}`} className={styles.nextLink}>
                {label} →
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SignalFieldMosaic({ groups }: { groups: SignalFieldGroup[] }) {
  const styles = useStyles2(getStyles);
  const [openGroupIndex, setOpenGroupIndex] = useState(0);

  return (
    <div className={styles.signalFieldMosaic} aria-label="Telemetry signal fields">
      {groups.map((group, index) => {
        const isOpen = index === openGroupIndex;
        const panelId = `telemetry-field-group-panel-${index}`;
        const buttonId = `telemetry-field-group-button-${index}`;

        return (
          <div key={group.title} className={cx(styles.signalFieldGroup, isOpen && styles.signalFieldGroupOpen)}>
            <button
              id={buttonId}
              type="button"
              className={styles.signalFieldGroupToggle}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenGroupIndex(index)}
            >
              <span className={styles.signalFieldGroupHeaderRow}>
                <span className={styles.signalFieldGroupTitle}>{group.title}</span>
                <span
                  className={cx(styles.signalFieldGroupChevron, isOpen && styles.signalFieldGroupChevronOpen)}
                  aria-hidden
                >
                  {'>'}
                </span>
              </span>
              <span className={styles.signalFieldGroupSubtitle}>{group.subtitle}</span>
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              className={cx(styles.signalFieldGroupPanel, isOpen && styles.signalFieldGroupPanelOpen)}
            >
              <div className={styles.signalFieldGroupPanelInner}>
                <ul className={styles.signalFieldList} aria-label={`${group.title} fields`}>
                  {group.fields.map((field) => (
                    <li key={field.name} className={styles.signalFieldListItem}>
                      <span className={styles.signalFieldName}>{field.name}</span>{' '}
                      <span className={styles.signalFieldType}>({field.type})</span>:{' '}
                      <span className={styles.signalFieldDescription}>{field.description}</span>
                      <div className={styles.signalFieldDetails}>{field.details}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WhatIsSigilGraphic({
  accentColor,
  secondaryColor,
  backgroundClassName,
  foregroundClassName,
}: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 240" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect
          x="36"
          y="24"
          width="228"
          height="184"
          rx="28"
          fill="#9aa0aa"
          opacity={0.1}
          transform="rotate(-2.8 150 116)"
        />
      </g>
      <g className={foregroundClassName} transform="rotate(1.5 150 120)">
        <circle cx="96" cy="96" r="22" fill={accentColor} />
        <rect x="128" y="82" width="104" height="8" rx="4" fill={accentColor} opacity={0.9} />
        <rect x="128" y="100" width="76" height="8" rx="4" fill={accentColor} opacity={0.7} />
        <rect x="128" y="118" width="52" height="8" rx="4" fill={accentColor} opacity={0.45} />
        <rect x="72" y="150" width="156" height="18" rx="9" fill={accentColor} opacity={0.3} />
      </g>
    </svg>
  );
}

function TelemetrySignalGraphic({
  accentColor,
  secondaryColor,
  backgroundClassName,
  foregroundClassName,
}: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 240" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect
          x="34"
          y="36"
          width="232"
          height="168"
          rx="26"
          fill="#9aa0aa"
          opacity={0.1}
          transform="rotate(3.2 150 120)"
        />
      </g>
      <g className={foregroundClassName} transform="rotate(-1.5 150 120)">
        <circle cx="86" cy="120" r="10" fill={accentColor} />
        <circle cx="146" cy="90" r="10" fill={accentColor} opacity={0.8} />
        <circle cx="202" cy="128" r="10" fill={accentColor} opacity={0.6} />
        <circle cx="246" cy="108" r="10" fill={accentColor} opacity={0.45} />
        <path d="M86 120 L146 90 L202 128 L246 108" stroke={accentColor} strokeWidth="4" fill="none" />
        <rect x="70" y="168" width="176" height="12" rx="6" fill={accentColor} opacity={0.3} />
      </g>
    </svg>
  );
}

function DatabaseGraphic({ accentColor, secondaryColor, backgroundClassName, foregroundClassName }: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 240" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <ellipse cx="150" cy="62" rx="88" ry="26" fill="#9aa0aa" opacity={0.1} transform="rotate(-3.4 150 120)" />
        <path
          d="M62 62V158C62 172 101 184 150 184C199 184 238 172 238 158V62"
          fill="#9aa0aa"
          opacity={0.1}
          transform="rotate(-3.4 150 120)"
        />
      </g>
      <g className={foregroundClassName} transform="rotate(1.5 150 120)">
        <ellipse cx="150" cy="62" rx="88" ry="26" fill={accentColor} opacity={0.6} />
        <ellipse cx="150" cy="94" rx="88" ry="26" fill={accentColor} opacity={0.42} />
        <ellipse cx="150" cy="126" rx="88" ry="26" fill={accentColor} opacity={0.3} />
        <ellipse cx="150" cy="158" rx="88" ry="26" fill={accentColor} opacity={0.2} />
      </g>
    </svg>
  );
}

function UiFeaturesGraphic({
  accentColor,
  secondaryColor,
  backgroundClassName,
  foregroundClassName,
}: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 240" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect
          x="38"
          y="30"
          width="224"
          height="180"
          rx="24"
          fill="#9aa0aa"
          opacity={0.1}
          transform="rotate(2.5 150 120)"
        />
      </g>
      <g className={foregroundClassName} transform="rotate(-1.5 150 120)">
        <rect x="58" y="52" width="184" height="20" rx="10" fill={accentColor} opacity={0.28} />
        <rect x="58" y="84" width="84" height="44" rx="12" fill={accentColor} />
        <rect x="152" y="84" width="90" height="20" rx="10" fill={accentColor} opacity={0.75} />
        <rect x="152" y="112" width="90" height="16" rx="8" fill={accentColor} opacity={0.48} />
        <rect x="58" y="138" width="54" height="54" rx="12" fill={accentColor} opacity={0.78} />
        <rect x="120" y="138" width="122" height="24" rx="12" fill={accentColor} opacity={0.6} />
        <rect x="120" y="170" width="92" height="22" rx="11" fill={accentColor} opacity={0.35} />
      </g>
    </svg>
  );
}

function AutoinstrumentationGraphic({
  accentColor,
  secondaryColor,
  backgroundClassName,
  foregroundClassName,
}: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 240" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect
          x="42"
          y="30"
          width="216"
          height="180"
          rx="26"
          fill="#9aa0aa"
          opacity={0.1}
          transform="rotate(-2.2 150 120)"
        />
      </g>
      <g className={foregroundClassName} transform="rotate(1.2 150 120)">
        <rect x="64" y="64" width="172" height="96" rx="16" fill={accentColor} opacity={0.18} />
        <rect x="78" y="82" width="84" height="12" rx="6" fill={accentColor} opacity={0.85} />
        <rect x="78" y="102" width="126" height="10" rx="5" fill={accentColor} opacity={0.62} />
        <rect x="78" y="118" width="104" height="10" rx="5" fill={accentColor} opacity={0.42} />
        <rect x="78" y="136" width="72" height="8" rx="4" fill={accentColor} opacity={0.3} />
        <circle cx="218" cy="98" r="16" fill={accentColor} opacity={0.9} />
        <path
          d="M212 98 L217 103 L226 94"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x="96" y="176" width="108" height="12" rx="6" fill={secondaryColor} opacity={0.45} />
      </g>
    </svg>
  );
}

function NextStepsGraphic({
  accentColor,
  secondaryColor,
  backgroundClassName,
  foregroundClassName,
}: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 240" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} transform="rotate(1.5 150 120)">
        <rect x="74" y="58" width="150" height="124" rx="18" fill={accentColor} opacity={0.16} />
      </g>
      <g className={foregroundClassName} transform="rotate(1.5 150 120)">
        <circle cx="100" cy="94" r="9" fill={accentColor} opacity={0.95} />
        <path
          d="M95 94 L99 99 L107 90"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x="118" y="90" width="84" height="8" rx="4" fill={accentColor} opacity={0.85} />
        <circle cx="100" cy="122" r="9" fill={accentColor} opacity={0.95} />
        <path
          d="M95 122 L99 127 L107 118"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x="118" y="118" width="72" height="8" rx="4" fill={accentColor} opacity={0.75} />
        <circle cx="100" cy="150" r="9" fill={accentColor} opacity={0.95} />
        <path
          d="M95 150 L99 155 L107 146"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x="118" y="146" width="92" height="8" rx="4" fill={accentColor} opacity={0.65} />
      </g>
    </svg>
  );
}

function getStyles(theme: GrafanaTheme2) {
  const backgroundDriftIn = keyframes({
    '0%': {
      transform: 'translate(-10px, 10px)',
      opacity: 0.8,
    },
    '100%': {
      transform: 'translate(0, 0)',
      opacity: 1,
    },
  });
  const foregroundDriftIn = keyframes({
    '0%': {
      transform: 'translate(10px, -10px)',
      opacity: 0.8,
    },
    '100%': {
      transform: 'translate(0, 0)',
      opacity: 1,
    },
  });
  const signalFieldTransitionMs = Math.round(theme.transitions.duration.short);

  return {
    page: css({
      minHeight: '100%',
      width: '100%',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: theme.spacing(5),
    }),
    card: css({
      width: 'min(1200px, 100%)',
      minHeight: 'min(64vh, 620px)',
      borderRadius: `calc(${theme.shape.radius.default} * 3)`,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z3,
      position: 'relative',
      overflow: 'hidden',
      padding: theme.spacing(6, 7, 4),
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      gap: theme.spacing(4),
    }),
    content: css({
      width: '100%',
      zIndex: 1,
      display: 'grid',
      gap: theme.spacing(2),
    }),
    topBar: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto auto',
      alignItems: 'center',
      gap: theme.spacing(2),
      paddingBottom: theme.spacing(1),
      '@media (max-width: 1024px)': {
        gridTemplateColumns: '1fr auto',
      },
    }),
    slideLayout: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 360px)',
      alignItems: 'start',
      gap: theme.spacing(4),
      '@media (max-width: 1024px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    textContent: css({
      maxWidth: '760px',
      display: 'grid',
      gap: theme.spacing(4),
    }),
    graphicFrame: css({
      justifySelf: 'end',
      width: '100%',
      maxWidth: '360px',
      aspectRatio: '5 / 4',
      '@media (max-width: 1024px)': {
        justifySelf: 'start',
        maxWidth: '320px',
      },
      '@media (max-width: 640px)': {
        maxWidth: '100%',
      },
    }),
    graphicBackgroundLayer: css({
      transformOrigin: 'center',
      animation: `${backgroundDriftIn} 900ms cubic-bezier(0.22, 1, 0.36, 1) both`,
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
      },
    }),
    graphicForegroundLayer: css({
      transformOrigin: 'center',
      animation: `${foregroundDriftIn} 1000ms cubic-bezier(0.22, 1, 0.36, 1) 60ms both`,
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
      },
    }),
    closeButton: css({
      textDecoration: 'none',
      color: theme.colors.text.primary,
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1,
      padding: theme.spacing(1, 1.5),
      borderRadius: `calc(${theme.shape.radius.default} * 1.25)`,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      justifySelf: 'end',
      transition: `background-color ${theme.transitions.duration.short}ms ease, border-color ${theme.transitions.duration.short}ms ease, transform ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        color: theme.colors.text.primary,
        background: theme.colors.action.hover,
        borderColor: 'var(--tutorial-accent)',
        transform: 'translateY(-1px)',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    title: css({
      margin: 0,
      fontSize: theme.typography.h1.fontSize,
      lineHeight: theme.typography.h1.lineHeight,
      letterSpacing: '-0.02em',
      fontWeight: theme.typography.fontWeightBold,
      position: 'relative',
      paddingBottom: theme.spacing(0.5),
      width: 'fit-content',
      marginTop: theme.spacing(-1),
      '&::after': {
        content: '""',
        position: 'absolute',
        left: -0,
        right: 0,
        bottom: -12,
        height: 8,
        background: 'var(--tutorial-accent)',
        borderRadius: 2,
        transform: 'rotate(-1.5deg)',
        transformOrigin: 'left center',
      },
      '@media (max-width: 1024px)': {
        gridColumn: '1 / 2',
      },
    }),
    subtitle: css({
      margin: 0,
      fontSize: theme.typography.h4.fontSize,
      lineHeight: theme.typography.h4.lineHeight,
      color: theme.colors.text.secondary,
      '&::before': {
        content: '">"',
        color: 'var(--tutorial-accent)',
        marginRight: theme.spacing(1),
      },
    }),
    subtitleBadge: css({
      margin: 0,
      width: 'fit-content',
      padding: theme.spacing(0.5, 1.25),
      borderRadius: `calc(${theme.shape.radius.default} * 1.5)`,
      border: `1px solid var(--tutorial-accent)`,
      background: theme.colors.background.secondary,
      color: theme.colors.text.primary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    body: css({
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      '& ul': {
        margin: 0,
        paddingLeft: theme.spacing(3),
        display: 'grid',
        gap: theme.spacing(1),
      },
      '& li::marker': {
        color: 'var(--tutorial-accent)',
      },
      '& p': {
        margin: 0,
      },
    }),
    contentFooter: css({
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(3),
      display: 'flex',
      justifyContent: 'flex-start',
    }),
    whereToGoNext: css({
      marginTop: theme.spacing(4),
      display: 'grid',
      gap: theme.spacing(1.5),
    }),
    whereToGoNextHeading: css({
      margin: 0,
      marginBottom: theme.spacing(0.5),
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
    }),
    whereToGoNextList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
      listStyleType: 'disc',
      listStylePosition: 'outside',
      '& li::marker': {
        color: 'var(--tutorial-accent)',
      },
    }),
    askAssistantLink: css({
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      font: 'inherit',
      padding: 0,
      textDecoration: 'none',
      color: 'var(--tutorial-accent)',
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1,
      transition: `color ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        textDecoration: 'underline',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    nextLink: css({
      textDecoration: 'none',
      color: 'var(--tutorial-accent)',
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1,
      transition: `color ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        textDecoration: 'underline',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    signalFieldMosaic: css({
      marginTop: theme.spacing(3),
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: theme.spacing(2),
    }),
    signalFieldGroup: css({
      display: 'grid',
      gap: theme.spacing(1),
      paddingLeft: theme.spacing(1.25),
      borderLeft: `2px solid ${theme.colors.border.weak}`,
      transition: `border-color ${signalFieldTransitionMs}ms ease, background-color ${signalFieldTransitionMs}ms ease`,
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'none',
      },
    }),
    signalFieldGroupOpen: css({
      borderLeftColor: 'var(--tutorial-accent)',
      background: theme.colors.background.secondary,
      paddingTop: theme.spacing(0.75),
      paddingBottom: theme.spacing(0.75),
      paddingRight: theme.spacing(0.75),
    }),
    signalFieldGroupToggle: css({
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      margin: 0,
      padding: 0,
      cursor: 'pointer',
      textAlign: 'left',
      display: 'grid',
      gap: theme.spacing(0.75),
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    signalFieldGroupHeaderRow: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      width: 'fit-content',
    }),
    signalFieldGroupTitle: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
    }),
    signalFieldGroupSubtitle: css({
      margin: 0,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      color: theme.colors.text.secondary,
    }),
    signalFieldGroupChevron: css({
      transform: 'rotate(90deg)',
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1,
      color: theme.colors.text.secondary,
      transition: `transform ${signalFieldTransitionMs}ms ease`,
    }),
    signalFieldGroupChevronOpen: css({
      transform: 'rotate(270deg)',
    }),
    signalFieldGroupPanel: css({
      display: 'grid',
      gridTemplateRows: '0fr',
      opacity: 0,
      transition: `grid-template-rows ${signalFieldTransitionMs}ms ease, opacity ${signalFieldTransitionMs}ms ease`,
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'none',
      },
    }),
    signalFieldGroupPanelOpen: css({
      gridTemplateRows: '1fr',
      opacity: 1,
    }),
    signalFieldGroupPanelInner: css({
      overflow: 'hidden',
      paddingTop: theme.spacing(0.5),
    }),
    signalFieldList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      listStyleType: 'disc',
      listStylePosition: 'outside',
      display: 'grid',
      gap: theme.spacing(1),
      '& li::marker': {
        color: 'var(--tutorial-accent)',
      },
    }),
    signalFieldListItem: css({
      display: 'list-item',
    }),
    signalFieldName: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: theme.typography.body.lineHeight,
    }),
    signalFieldType: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: theme.typography.body.lineHeight,
    }),
    signalFieldDescription: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      color: theme.colors.text.primary,
    }),
    signalFieldDetails: css({
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      color: theme.colors.text.secondary,
    }),
    navigation: css({
      zIndex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(2),
      marginRight: theme.spacing(2),
      userSelect: 'none',
      '@media (max-width: 1024px)': {
        gridColumn: '1 / -1',
        order: 3,
      },
    }),
    arrowButton: css({
      textDecoration: 'none',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1,
      minWidth: '28px',
      textAlign: 'center',
      opacity: 0.7,
      transition: `opacity ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        opacity: 1,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    arrowButtonDisabled: css({
      opacity: 0.2,
    }),
    dotList: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    dot: css({
      width: '12px',
      height: '12px',
      borderRadius: '9999px',
      border: `1px solid ${theme.colors.text.secondary}`,
      opacity: 0.5,
      textDecoration: 'none',
      transition: `opacity ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        opacity: 0.8,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    dotActive: css({
      background: theme.colors.text.primary,
      borderColor: theme.colors.text.primary,
      opacity: 1,
    }),
  };
}
