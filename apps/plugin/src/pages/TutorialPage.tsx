import React, { useEffect, useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAssistant } from '@grafana/assistant';
import { SparklesBackground } from '../components/landing/SparklesBackground';
import { AutoinstrumentationPanel } from '../components/tutorial/TryItNowPanel';
import {
  buildSigilAssistantContextItems,
  buildSigilAssistantPrompt,
  withSigilProjectContextFallback,
} from '../content/assistantContext';
import { PLUGIN_BASE, ROUTES } from '../constants';

type TutorialSlide = {
  slug: string;
  title: string;
  subtitle: string;
  subtitleBadge?: string;
  renderGraphic?: (props: SlideGraphicProps) => React.ReactNode;
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
    slug: 'what-is-ai-observability',
    title: 'What is AI Observability?',
    subtitle: 'Visibility into what your AI is doing, costing, and getting wrong',
    renderGraphic: (props) => <AiObservabilityGraphic {...props} />,
    body: (
      <>
        <p>
          Traditional observability tracks requests, errors, and latency. AI observability adds a layer purpose-built
          for LLM applications — tracking conversations, token usage, cost, model behavior, and output quality.
        </p>
        <ul>
          <li>Know when agents break, hallucinate, slow down, or cost too much.</li>
          <li>Understand what prompts and tools each model version uses.</li>
          <li>Score output quality on live traffic, not just in staging.</li>
          <li>Built for engineering teams running agents, chatbots, and RAG pipelines in production.</li>
        </ul>
      </>
    ),
  },
  {
    slug: 'what-is-sigil',
    title: 'What is Sigil?',
    subtitle: 'A new open-source database and platform for AI observability',
    renderGraphic: (props) => <WhatIsSigilGraphic {...props} />,
    body: (
      <>
        <p>
          Sigil is an OpenTelemetry-native database and platform purpose-built for AI generation data. It captures
          conversations, token usage, cost, and quality as a first-class signal alongside your existing traces and
          metrics.
        </p>
        <ul>
          <li>New database for AI conversations — not retrofitted spans or logs.</li>
          <li>SDKs for Go, Python, TypeScript, Java, and .NET.</li>
          <li>Plugs into Grafana, Tempo, Prometheus, and your existing OTel pipeline.</li>
          <li>Open spec, open source — no vendor lock-in.</li>
        </ul>
      </>
    ),
  },
  {
    slug: 'about-the-database',
    title: 'A new signal, a new database',
    subtitle: 'AI conversations as a first-class signal, linked to your traces.',
    renderGraphic: (props) => <DatabaseGraphic {...props} />,
    body: (
      <>
        <p>
          Traces, logs, and metrics don&apos;t capture conversation structure, token costs, or generation chains. Sigil
          stores AI conversations as a new signal and links them back to traces via <code>trace_id</code> — so you get
          both the full picture and deep drilldowns.
        </p>
        <ul>
          <li>Built for generations, not retrofitted spans.</li>
          <li>Fast queries by time, model, agent, and labels.</li>
          <li>Built on the same principles as Mimir, Loki, Tempo, and other Grafana databases.</li>
        </ul>
      </>
    ),
  },
  {
    slug: 'about-the-telemetry-signal',
    title: 'A modern signal for modern software',
    subtitle: 'Generation-first telemetry for LLM applications',
    body: <TelemetrySignalBody />,
  },
  {
    slug: 'autoinstrumentation',
    title: 'Autoinstrumentation',
    subtitle: 'From zero to instrumented in minutes, not days.',
    renderGraphic: (props) => <AutoinstrumentationGraphic {...props} />,
    body: <AutoinstrumentationBody />,
  },
  {
    slug: 'ui-features',
    title: 'The Grafana Sigil app',
    subtitle: 'Everything your AI is doing, in one place.',
    renderGraphic: (props) => <UiFeaturesGraphic {...props} />,
    body: (
      <>
        <p>
          Once your application is instrumented, the Sigil app gives you a dedicated UI to explore and act on the data.
        </p>
        <ul>
          <li>
            <strong>Analytics</strong> — activity, latency, errors, token usage, and cost at a glance.
          </li>
          <li>
            <strong>Conversations</strong> — inspect the full thread, tool calls, traces, scores, and cost breakdowns.
          </li>
          <li>
            <strong>Agents</strong> — track versions, prompt and tool footprints, and usage per version.
          </li>
          <li>
            <strong>Evaluation</strong> — score production traffic continuously and catch quality regressions.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: 'next-steps',
    title: 'Next steps',
    subtitle: 'Start instrumenting. The data speaks for itself.',
    renderGraphic: (props) => <NextStepsGraphic {...props} />,
    body: <NextStepsBody />,
  },
];

const TUTORIAL_COLORS = ['#5794F2', '#7B88F0', '#8A7DEE', '#B877D9', '#DA7AAF', '#F28B4E', '#FF9830'];

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
      <SparklesBackground className={styles.pageSparklesLayer} withGradient={false} />
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
          <div className={slide.renderGraphic ? styles.slideLayout : styles.slideLayoutFull}>
            <div className={slide.renderGraphic ? styles.textContent : styles.textContentFull}>
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
            {slide.renderGraphic ? (
              <div className={styles.graphicFrame} aria-hidden>
                {slide.renderGraphic({
                  accentColor: slideAccentColor,
                  secondaryColor: slideSecondaryColor,
                  backgroundClassName: styles.graphicBackgroundLayer,
                  foregroundClassName: styles.graphicForegroundLayer,
                })}
              </div>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

function TelemetrySignalBody() {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.signalSlideLayout}>
      <p>
        Each LLM call is captured as a <strong>generation</strong> — prompt, response, tokens, latency, cost, and status
        in one record. Generations group into <strong>conversations</strong> so you can trace multi-turn chats and
        agentic workflows end to end.
      </p>
      <div className={styles.signalSlideReference}>
        <div className={styles.signalSlideReferenceHeader}>
          <span className={styles.signalSlideReferenceLabel}>Generation schema reference</span>
        </div>
        <SignalFieldMosaic groups={SIGNAL_FIELD_GROUPS} />
      </div>
    </div>
  );
}

function AutoinstrumentationBody() {
  return (
    <>
      <p>You can autoinstrument it in one click to see what your models are doing in production.</p>
      <ul>
        <li>AI-powered tools that add instrumentation to your app for you.</li>
        <li>An interactive agent that asks what it needs as it goes.</li>
        <li>Works for greenfield and existing codebases alike.</li>
        <li>See results immediately in the Sigil UI.</li>
      </ul>
      <AutoinstrumentationPanel />
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

  const openAssistant = () => {
    const prompt = buildSigilAssistantPrompt('What is Sigil and how can I get started?');
    if (assistant.openAssistant) {
      assistant.openAssistant({
        origin: ASSISTANT_ORIGIN_TUTORIAL,
        prompt,
        context: buildSigilAssistantContextItems(),
        autoSend: true,
      });
    } else {
      window.location.href = buildAssistantUrl(withSigilProjectContextFallback(prompt));
    }
  };

  return (
    <>
      <ol>
        <li>
          <strong>Instrument your app</strong> — use autoinstrumentation or add the SDK to your codebase.
        </li>
        <li>
          <strong>Send traffic</strong> — make a few LLM calls so data starts flowing into Sigil.
        </li>
        <li>
          <strong>Explore your data</strong> — open{' '}
          <Link to={`${base}/${ROUTES.Analytics}`} className={styles.inlineLink}>
            Analytics
          </Link>
          ,{' '}
          <Link to={`${base}/${ROUTES.Conversations}`} className={styles.inlineLink}>
            Conversations
          </Link>
          , and{' '}
          <Link to={`${base}/${ROUTES.Agents}`} className={styles.inlineLink}>
            Agents
          </Link>{' '}
          to see what your models are doing.
        </li>
        <li>
          <strong>Set up evaluation</strong> — configure{' '}
          <Link to={`${base}/${ROUTES.Evaluation}`} className={styles.inlineLink}>
            online evaluation
          </Link>{' '}
          to score production traffic and catch regressions.
        </li>
      </ol>
      <div className={styles.contentFooter} style={{ gap: '24px' }}>
        <a
          href="https://github.com/grafana/sigil#readme"
          target="_blank"
          rel="noreferrer"
          className={styles.askAssistantLink}
        >
          Read the docs →
        </a>
        <button type="button" className={styles.askAssistantLink} onClick={openAssistant}>
          Ask Assistant about Sigil →
        </button>
      </div>
    </>
  );
}

function SignalFieldMosaic({ groups }: { groups: SignalFieldGroup[] }) {
  const styles = useStyles2(getStyles);
  const [activeTab, setActiveTab] = useState(0);
  const activeGroup = groups[activeTab];

  return (
    <div className={styles.signalFieldMosaic} aria-label="Telemetry signal fields">
      <div className={styles.signalFieldTabs} role="tablist">
        {groups.map((group, index) => (
          <button
            key={group.title}
            role="tab"
            aria-selected={index === activeTab}
            aria-controls={`telemetry-tab-panel-${index}`}
            id={`telemetry-tab-${index}`}
            className={cx(styles.signalFieldTab, index === activeTab && styles.signalFieldTabActive)}
            onClick={() => setActiveTab(index)}
          >
            {group.title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`telemetry-tab-panel-${activeTab}`}
        aria-labelledby={`telemetry-tab-${activeTab}`}
        className={styles.signalFieldTabPanel}
      >
        <p className={styles.signalFieldTabSubtitle}>{activeGroup.subtitle}</p>
        <ul className={styles.signalFieldList} aria-label={`${activeGroup.title} fields`}>
          {activeGroup.fields.map((field) => (
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
  );
}

function AiObservabilityGraphic({
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
          height="192"
          rx="28"
          fill="#9aa0aa"
          opacity={0.08}
          transform="rotate(-2 150 120)"
        />
      </g>
      <g className={foregroundClassName} transform="rotate(1 150 120)">
        {/* Magnifying glass / lens */}
        <circle cx="138" cy="104" r="48" fill="none" stroke={accentColor} strokeWidth="3" opacity={0.25} />
        <circle cx="138" cy="104" r="48" fill={accentColor} opacity={0.04} />
        <line
          x1="172"
          y1="138"
          x2="198"
          y2="164"
          stroke={accentColor}
          strokeWidth="4"
          strokeLinecap="round"
          opacity={0.3}
        />

        {/* Data lines inside lens */}
        <rect x="106" y="82" width="64" height="6" rx="3" fill={accentColor} opacity={0.7} />
        <rect x="106" y="94" width="48" height="6" rx="3" fill={secondaryColor} opacity={0.6} />
        <rect x="106" y="106" width="56" height="6" rx="3" fill={accentColor} opacity={0.5} />
        <rect x="106" y="118" width="38" height="6" rx="3" fill={secondaryColor} opacity={0.4} />

        {/* Sparkle accents */}
        <circle cx="82" cy="56" r="3" fill={accentColor} opacity={0.5} />
        <circle cx="206" cy="72" r="2.5" fill={secondaryColor} opacity={0.4} />
        <circle cx="72" cy="156" r="2" fill={accentColor} opacity={0.35} />
        <circle cx="220" cy="148" r="3.5" fill={secondaryColor} opacity={0.3} />

        {/* Bottom bar */}
        <rect x="72" y="176" width="156" height="14" rx="7" fill={accentColor} opacity={0.2} />
        <rect x="72" y="176" width="104" height="14" rx="7" fill={accentColor} opacity={0.35} />
      </g>
    </svg>
  );
}

function WhatIsSigilGraphic({
  accentColor,
  secondaryColor,
  backgroundClassName,
  foregroundClassName,
}: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 320 300" width="100%" height="100%" focusable={false}>
      <defs>
        <marker
          id="sigilArrow"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L6 3 L0 6 Z" fill={accentColor} opacity={0.5} />
        </marker>
      </defs>

      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect x="15" y="8" width="290" height="284" rx="20" fill="#9aa0aa" opacity={0.06} />
      </g>

      <g className={foregroundClassName}>
        {/* Your AI App */}
        <rect x="95" y="22" width="110" height="32" rx="8" fill={accentColor} opacity={0.85} />
        <text x="150" y="43" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
          Your AI App
        </text>

        {/* Left path: OTLP traces + metrics -> Alloy */}
        <path
          d="M120 54 L70 92"
          stroke={accentColor}
          strokeWidth="1.5"
          opacity={0.35}
          fill="none"
          markerEnd="url(#sigilArrow)"
        />
        <text x="78" y="70" textAnchor="middle" fontSize="6" fill={accentColor} opacity={0.5}>
          OTLP
        </text>

        {/* Right path: Generations -> Sigil API */}
        <path
          d="M180 54 L230 92"
          stroke={secondaryColor}
          strokeWidth="1.5"
          opacity={0.35}
          fill="none"
          markerEnd="url(#sigilArrow)"
        />
        <text x="222" y="70" textAnchor="middle" fontSize="6" fill={secondaryColor} opacity={0.5}>
          generations
        </text>

        {/* Alloy / Collector */}
        <rect x="24" y="98" width="92" height="28" rx="7" fill={accentColor} opacity={0.5} />
        <text x="70" y="116" textAnchor="middle" fontSize="8" fontWeight="600" fill="#fff">
          Alloy / Collector
        </text>

        {/* Sigil API */}
        <rect x="184" y="98" width="92" height="28" rx="7" fill={secondaryColor} opacity={0.7} />
        <text x="230" y="116" textAnchor="middle" fontSize="8" fontWeight="600" fill="#fff">
          Sigil API
        </text>

        {/* Alloy -> Tempo */}
        <path
          d="M50 126 L50 166"
          stroke={accentColor}
          strokeWidth="1.5"
          opacity={0.3}
          fill="none"
          markerEnd="url(#sigilArrow)"
        />
        {/* Alloy -> Prometheus */}
        <path
          d="M90 126 L90 166"
          stroke={accentColor}
          strokeWidth="1.5"
          opacity={0.3}
          fill="none"
          markerEnd="url(#sigilArrow)"
        />

        {/* Tempo */}
        <rect x="24" y="172" width="52" height="26" rx="6" fill={accentColor} opacity={0.25} />
        <text x="50" y="189" textAnchor="middle" fontSize="8" fontWeight="500" fill={accentColor}>
          Tempo
        </text>

        {/* Prometheus */}
        <rect x="82" y="172" width="66" height="26" rx="6" fill={accentColor} opacity={0.25} />
        <text x="115" y="189" textAnchor="middle" fontSize="7.5" fontWeight="500" fill={accentColor}>
          Prometheus
        </text>

        {/* Sigil API -> MySQL */}
        <path
          d="M210 126 L210 166"
          stroke={secondaryColor}
          strokeWidth="1.5"
          opacity={0.3}
          fill="none"
          markerEnd="url(#sigilArrow)"
        />
        {/* Sigil API -> Object storage */}
        <path
          d="M250 126 L250 166"
          stroke={secondaryColor}
          strokeWidth="1.5"
          opacity={0.3}
          fill="none"
          markerEnd="url(#sigilArrow)"
        />

        {/* MySQL */}
        <rect x="184" y="172" width="52" height="26" rx="6" fill={secondaryColor} opacity={0.25} />
        <text x="210" y="189" textAnchor="middle" fontSize="8" fontWeight="500" fill={secondaryColor}>
          MySQL
        </text>

        {/* Object storage */}
        <rect x="240" y="168" width="48" height="34" rx="6" fill={secondaryColor} opacity={0.25} />
        <text x="264" y="183" textAnchor="middle" fontSize="6" fontWeight="500" fill={secondaryColor}>
          Object
        </text>
        <text x="264" y="194" textAnchor="middle" fontSize="6" fontWeight="500" fill={secondaryColor}>
          storage
        </text>

        {/* Divider */}
        <line x1="36" y1="218" x2="264" y2="218" stroke={accentColor} strokeWidth="0.5" opacity={0.15} />

        {/* Grafana + Sigil plugin */}
        <rect
          x="75"
          y="236"
          width="150"
          height="34"
          rx="8"
          fill={accentColor}
          opacity={0.15}
          stroke={accentColor}
          strokeWidth="1"
          strokeOpacity={0.2}
        />
        <text x="150" y="258" textAnchor="middle" fontSize="11" fontWeight="600" fill={accentColor}>
          Grafana + Sigil
        </text>

        {/* Query arrows up from Grafana */}
        <path
          d="M108 236 L68 198"
          stroke={accentColor}
          strokeWidth="1"
          opacity={0.2}
          fill="none"
          strokeDasharray="3 2"
        />
        <path
          d="M135 236 L115 198"
          stroke={accentColor}
          strokeWidth="1"
          opacity={0.2}
          fill="none"
          strokeDasharray="3 2"
        />
        <path
          d="M178 236 L210 198"
          stroke={secondaryColor}
          strokeWidth="1"
          opacity={0.2}
          fill="none"
          strokeDasharray="3 2"
        />

        {/* Labels on query arrows */}
        <text x="76" y="222" textAnchor="middle" fontSize="5.5" fill={accentColor} opacity={0.4}>
          traces
        </text>
        <text x="130" y="222" textAnchor="middle" fontSize="5.5" fill={accentColor} opacity={0.4}>
          metrics
        </text>
        <text x="202" y="222" textAnchor="middle" fontSize="5.5" fill={secondaryColor} opacity={0.4}>
          generations
        </text>
      </g>
    </svg>
  );
}

function DatabaseGraphic({ accentColor, secondaryColor, backgroundClassName, foregroundClassName }: SlideGraphicProps) {
  return (
    <svg viewBox="0 0 300 280" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect x="20" y="10" width="260" height="260" rx="20" fill="#9aa0aa" opacity={0.06} />
      </g>
      <g className={foregroundClassName}>
        {/* Conversation bubble chain */}
        <rect x="30" y="24" width="110" height="26" rx="7" fill={accentColor} opacity={0.8} />
        <text x="85" y="42" textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">
          Conversation
        </text>

        {/* Generation nodes */}
        <rect x="46" y="68" width="78" height="22" rx="5" fill={accentColor} opacity={0.5} />
        <text x="85" y="83" textAnchor="middle" fontSize="8" fill="#fff">
          Generation 1
        </text>

        <rect x="46" y="100" width="78" height="22" rx="5" fill={accentColor} opacity={0.5} />
        <text x="85" y="115" textAnchor="middle" fontSize="8" fill="#fff">
          Generation 2
        </text>

        <rect x="46" y="132" width="78" height="22" rx="5" fill={accentColor} opacity={0.5} />
        <text x="85" y="147" textAnchor="middle" fontSize="8" fill="#fff">
          Generation 3
        </text>

        {/* Chain lines */}
        <path d="M85 50 L85 68" stroke={accentColor} strokeWidth="1" opacity={0.4} fill="none" />
        <path d="M85 90 L85 100" stroke={accentColor} strokeWidth="1" opacity={0.4} fill="none" />
        <path d="M85 122 L85 132" stroke={accentColor} strokeWidth="1" opacity={0.4} fill="none" />

        {/* Link arrows to trace */}
        <path
          d="M124 79 L172 62"
          stroke={secondaryColor}
          strokeWidth="1.5"
          opacity={0.5}
          fill="none"
          strokeDasharray="3 2"
        />
        <path
          d="M124 111 L172 111"
          stroke={secondaryColor}
          strokeWidth="1.5"
          opacity={0.5}
          fill="none"
          strokeDasharray="3 2"
        />
        <path
          d="M124 143 L172 160"
          stroke={secondaryColor}
          strokeWidth="1.5"
          opacity={0.5}
          fill="none"
          strokeDasharray="3 2"
        />

        {/* Trace waterfall */}
        <rect x="172" y="36" width="96" height="18" rx="4" fill={secondaryColor} opacity={0.3} />
        <text x="220" y="49" textAnchor="middle" fontSize="8" fill={secondaryColor} opacity={0.8}>
          trace
        </text>

        <rect x="182" y="60" width="76" height="14" rx="3" fill={secondaryColor} opacity={0.45} />
        <rect x="192" y="80" width="56" height="14" rx="3" fill={secondaryColor} opacity={0.35} />
        <rect x="182" y="104" width="76" height="14" rx="3" fill={secondaryColor} opacity={0.45} />
        <rect x="192" y="124" width="66" height="14" rx="3" fill={secondaryColor} opacity={0.35} />
        <rect x="182" y="152" width="76" height="14" rx="3" fill={secondaryColor} opacity={0.45} />
        <rect x="192" y="172" width="46" height="14" rx="3" fill={secondaryColor} opacity={0.35} />

        {/* trace_id label */}
        <text
          x="150"
          y="210"
          textAnchor="middle"
          fontSize="9"
          fontFamily="monospace"
          fill={secondaryColor}
          opacity={0.6}
        >
          trace_id
        </text>
        <path d="M115 206 L133 206" stroke={secondaryColor} strokeWidth="1" opacity={0.3} fill="none" />
        <path d="M167 206 L185 206" stroke={secondaryColor} strokeWidth="1" opacity={0.3} fill="none" />

        {/* Database icon at bottom */}
        <ellipse cx="85" cy="236" rx="32" ry="9" fill={accentColor} opacity={0.4} />
        <path d="M53 236 L53 252 Q53 261 85 261 Q117 261 117 252 L117 236" fill={accentColor} opacity={0.2} />
        <ellipse cx="85" cy="252" rx="32" ry="9" fill={accentColor} opacity={0.15} />
        <text x="85" y="243" textAnchor="middle" fontSize="7" fill={accentColor} opacity={0.7}>
          Sigil DB
        </text>

        {/* Tempo icon at bottom right */}
        <ellipse cx="220" cy="236" rx="32" ry="9" fill={secondaryColor} opacity={0.4} />
        <path d="M188 236 L188 252 Q188 261 220 261 Q252 261 252 252 L252 236" fill={secondaryColor} opacity={0.2} />
        <ellipse cx="220" cy="252" rx="32" ry="9" fill={secondaryColor} opacity={0.15} />
        <text x="220" y="243" textAnchor="middle" fontSize="7" fill={secondaryColor} opacity={0.7}>
          Tempo
        </text>

        <path d="M85 158 L85 227" stroke={accentColor} strokeWidth="1" opacity={0.3} fill="none" />
        <path d="M220 190 L220 227" stroke={secondaryColor} strokeWidth="1" opacity={0.3} fill="none" />
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
    <svg viewBox="0 0 340 280" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect x="20" y="16" width="300" height="248" rx="20" fill="#9aa0aa" opacity={0.06} />
      </g>
      <g className={foregroundClassName}>
        {/* Analytics card */}
        <rect
          x="34"
          y="34"
          width="130"
          height="76"
          rx="10"
          fill={accentColor}
          opacity={0.12}
          stroke={accentColor}
          strokeWidth="1"
          strokeOpacity={0.2}
        />
        <text x="99" y="54" textAnchor="middle" fontSize="9" fontWeight="700" fill={accentColor}>
          Analytics
        </text>
        <rect x="50" y="88" width="10" height="14" rx="2" fill={accentColor} opacity={0.45} />
        <rect x="64" y="82" width="10" height="20" rx="2" fill={accentColor} opacity={0.55} />
        <rect x="78" y="74" width="10" height="28" rx="2" fill={accentColor} opacity={0.65} />
        <rect x="92" y="84" width="10" height="18" rx="2" fill={accentColor} opacity={0.5} />
        <rect x="106" y="78" width="10" height="24" rx="2" fill={accentColor} opacity={0.6} />
        <rect x="120" y="70" width="10" height="32" rx="2" fill={accentColor} opacity={0.75} />

        {/* Conversations card */}
        <rect
          x="176"
          y="34"
          width="130"
          height="76"
          rx="10"
          fill={secondaryColor}
          opacity={0.12}
          stroke={secondaryColor}
          strokeWidth="1"
          strokeOpacity={0.2}
        />
        <text x="241" y="54" textAnchor="middle" fontSize="9" fontWeight="700" fill={secondaryColor}>
          Conversations
        </text>
        <rect x="192" y="68" width="60" height="10" rx="5" fill={secondaryColor} opacity={0.4} />
        <rect x="216" y="84" width="68" height="10" rx="5" fill={secondaryColor} opacity={0.3} />

        {/* Agents card */}
        <rect
          x="34"
          y="124"
          width="130"
          height="76"
          rx="10"
          fill={secondaryColor}
          opacity={0.12}
          stroke={secondaryColor}
          strokeWidth="1"
          strokeOpacity={0.2}
        />
        <text x="99" y="144" textAnchor="middle" fontSize="9" fontWeight="700" fill={secondaryColor}>
          Agents
        </text>
        <circle cx="72" cy="170" r="8" fill={secondaryColor} opacity={0.5} />
        <circle cx="96" cy="170" r="8" fill={secondaryColor} opacity={0.4} />
        <circle cx="120" cy="170" r="8" fill={secondaryColor} opacity={0.3} />
        <text x="72" y="173" textAnchor="middle" fontSize="6" fontWeight="600" fill="#fff">
          v3
        </text>
        <text x="96" y="173" textAnchor="middle" fontSize="6" fontWeight="600" fill="#fff">
          v2
        </text>
        <text x="120" y="173" textAnchor="middle" fontSize="6" fontWeight="600" fill="#fff">
          v1
        </text>

        {/* Evaluation card */}
        <rect
          x="176"
          y="124"
          width="130"
          height="76"
          rx="10"
          fill={accentColor}
          opacity={0.12}
          stroke={accentColor}
          strokeWidth="1"
          strokeOpacity={0.2}
        />
        <text x="241" y="144" textAnchor="middle" fontSize="9" fontWeight="700" fill={accentColor}>
          Evaluation
        </text>
        <rect x="192" y="158" width="98" height="6" rx="3" fill={accentColor} opacity={0.15} />
        <rect x="192" y="158" width="74" height="6" rx="3" fill={accentColor} opacity={0.55} />
        <rect x="192" y="170" width="98" height="6" rx="3" fill={accentColor} opacity={0.15} />
        <rect x="192" y="170" width="86" height="6" rx="3" fill={accentColor} opacity={0.45} />
        <rect x="192" y="182" width="98" height="6" rx="3" fill={accentColor} opacity={0.15} />
        <rect x="192" y="182" width="54" height="6" rx="3" fill={accentColor} opacity={0.35} />

        {/* Bottom insight bar */}
        <rect
          x="34"
          y="218"
          width="272"
          height="30"
          rx="10"
          fill={accentColor}
          opacity={0.06}
          stroke={accentColor}
          strokeWidth="1"
          strokeOpacity={0.12}
        />
        <circle cx="54" cy="233" r="6" fill={accentColor} opacity={0.45} />
        <text x="54" y="236" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff">
          !
        </text>
        <text x="70" y="236" fontSize="7" fill={accentColor} opacity={0.65}>
          3 insights found &middot; cost spike on gpt-5 &middot; error rate up
        </text>
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
    <svg viewBox="0 0 340 280" width="100%" height="100%" focusable={false}>
      <g className={backgroundClassName} style={{ filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35))' }}>
        <rect x="20" y="16" width="300" height="248" rx="20" fill="#9aa0aa" opacity={0.06} />
      </g>
      <g className={foregroundClassName}>
        {/* Vertical progress line */}
        <line x1="60" y1="52" x2="60" y2="232" stroke={accentColor} strokeWidth="2" opacity={0.15} />

        {/* Step 1: Instrument */}
        <circle cx="60" cy="62" r="12" fill={accentColor} opacity={0.9} />
        <text x="60" y="66" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          1
        </text>
        <text x="84" y="58" fontSize="10" fontWeight="700" fill={accentColor}>
          Instrument
        </text>
        <text x="84" y="72" fontSize="8" fill={accentColor} opacity={0.5}>
          Add SDK or autoinstrument
        </text>

        {/* Step 2: Send traffic */}
        <circle cx="60" cy="112" r="12" fill={accentColor} opacity={0.7} />
        <text x="60" y="116" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          2
        </text>
        <text x="84" y="108" fontSize="10" fontWeight="700" fill={accentColor} opacity={0.85}>
          Send traffic
        </text>
        <text x="84" y="122" fontSize="8" fill={accentColor} opacity={0.45}>
          Make LLM calls, data flows in
        </text>

        {/* Step 3: Explore */}
        <circle cx="60" cy="162" r="12" fill={accentColor} opacity={0.55} />
        <text x="60" y="166" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          3
        </text>
        <text x="84" y="158" fontSize="10" fontWeight="700" fill={accentColor} opacity={0.7}>
          Explore
        </text>
        <text x="84" y="172" fontSize="8" fill={accentColor} opacity={0.4}>
          Analytics, conversations, agents
        </text>

        {/* Step 4: Evaluate */}
        <circle cx="60" cy="212" r="12" fill={accentColor} opacity={0.4} />
        <text x="60" y="216" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          4
        </text>
        <text x="84" y="208" fontSize="10" fontWeight="700" fill={accentColor} opacity={0.55}>
          Evaluate
        </text>
        <text x="84" y="222" fontSize="8" fill={accentColor} opacity={0.35}>
          Score quality, catch regressions
        </text>

        {/* Rocket */}
        <g transform="translate(268, 42)">
          <path d="M0 28 L8 0 L16 28 Q8 24 0 28 Z" fill={accentColor} opacity={0.8} />
          <rect x="5" y="20" width="6" height="4" rx="1" fill="#fff" opacity={0.6} />
          <path d="M2 28 L8 36 L14 28" fill={secondaryColor} opacity={0.5} />
          <line
            x1="8"
            y1="38"
            x2="8"
            y2="50"
            stroke={secondaryColor}
            strokeWidth="2"
            opacity={0.3}
            strokeDasharray="2 3"
          />
          <line
            x1="5"
            y1="42"
            x2="5"
            y2="52"
            stroke={secondaryColor}
            strokeWidth="1.5"
            opacity={0.2}
            strokeDasharray="2 3"
          />
          <line
            x1="11"
            y1="40"
            x2="11"
            y2="48"
            stroke={secondaryColor}
            strokeWidth="1.5"
            opacity={0.2}
            strokeDasharray="2 3"
          />
        </g>
      </g>
    </svg>
  );
}

function getStyles(theme: GrafanaTheme2) {
  const pageHorizontalPadding = theme.spacing(2);
  const pageHorizontalBleed = theme.spacing(4);
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
      position: 'relative',
      minHeight: '100%',
      width: `calc(100% + ${pageHorizontalBleed})`,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      marginLeft: `calc(-1 * ${pageHorizontalPadding})`,
      marginRight: `calc(-1 * ${pageHorizontalPadding})`,
      padding: 0,
      overflow: 'hidden',
    }),
    pageSparklesLayer: css({
      position: 'absolute',
      inset: 0,
      zIndex: 0,
    }),
    card: css({
      width: 'min(1200px, 100%)',
      minHeight: 'min(64vh, 620px)',
      borderRadius: `calc(${theme.shape.radius.default} * 3)`,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.isDark
        ? `linear-gradient(160deg, ${theme.colors.background.primary} 0%, rgba(22, 27, 45, 0.97) 100%)`
        : theme.colors.background.primary,
      backdropFilter: 'blur(8px) saturate(1.1)',
      boxShadow: theme.isDark ? `${theme.shadows.z3}, 0 0 80px rgba(87, 148, 242, 0.06)` : theme.shadows.z3,
      position: 'relative',
      zIndex: 1,
      overflow: 'hidden',
      padding: theme.spacing(6, 7, 4),
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      gap: theme.spacing(4),
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'linear-gradient(90deg, #5794F2 0%, #B877D9 52%, #FF9830 100%)',
        zIndex: 2,
      },
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
    slideLayoutFull: css({
      display: 'grid',
      gridTemplateColumns: '1fr',
      alignItems: 'start',
      gap: theme.spacing(4),
    }),
    signalSlideLayout: css({
      display: 'grid',
      gap: theme.spacing(3),
    }),
    signalSlideExplainer: css({
      display: 'grid',
      gap: theme.spacing(2),
      '& p': {
        margin: 0,
        fontSize: theme.typography.body.fontSize,
        lineHeight: 1.7,
        color: theme.colors.text.secondary,
      },
      '& strong': {
        color: theme.colors.text.primary,
      },
    }),
    signalSlideReference: css({
      display: 'grid',
      gap: theme.spacing(1),
      background: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(1.5),
      maxHeight: '310px',
      overflowY: 'auto',
    }),
    signalSlideReferenceHeader: css({
      display: 'grid',
      gap: theme.spacing(0.25),
    }),
    signalSlideReferenceLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: 'var(--tutorial-accent)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }),
    signalSlideReferenceHint: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.disabled,
    }),
    textContent: css({
      maxWidth: '760px',
      display: 'grid',
      gap: theme.spacing(2),
    }),
    textContentFull: css({
      display: 'grid',
      gap: theme.spacing(2),
      width: '100%',
    }),
    graphicFrame: css({
      justifySelf: 'end',
      alignSelf: 'center',
      width: '100%',
      maxWidth: '380px',
      '@media (max-width: 1024px)': {
        justifySelf: 'start',
        maxWidth: '340px',
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
      letterSpacing: '-0.03em',
      fontWeight: theme.typography.fontWeightBold,
      position: 'relative',
      paddingBottom: theme.spacing(0.5),
      width: 'fit-content',
      marginTop: theme.spacing(-1),
      '&::after': {
        content: '""',
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: -9,
        height: 4,
        background: 'linear-gradient(90deg, var(--tutorial-accent) 0%, var(--tutorial-secondary) 100%)',
        borderRadius: 2,
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
      letterSpacing: '-0.01em',
      '&::before': {
        content: '">"',
        color: 'var(--tutorial-accent)',
        marginRight: theme.spacing(1),
        fontFamily: theme.typography.fontFamilyMonospace,
        fontWeight: theme.typography.fontWeightBold,
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
      '& ul, & ol': {
        margin: 0,
        paddingLeft: theme.spacing(3),
        display: 'grid',
        gap: theme.spacing(1.25),
      },
      '& p + ul, & p + ol': {
        marginTop: theme.spacing(2),
      },
      '& li::marker': {
        color: 'var(--tutorial-accent)',
      },
      '& li strong': {
        color: theme.colors.text.primary,
      },
      '& p': {
        margin: 0,
        color: theme.colors.text.secondary,
      },
      '& :not(pre) > code': {
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: '0.9em',
        padding: theme.spacing(0.25, 0.75),
        borderRadius: theme.shape.radius.default,
        background: theme.isDark ? 'rgba(87, 148, 242, 0.12)' : 'rgba(87, 148, 242, 0.08)',
        color: 'var(--tutorial-accent)',
        border: `1px solid ${theme.isDark ? 'rgba(87, 148, 242, 0.2)' : 'rgba(87, 148, 242, 0.15)'}`,
      },
    }),
    inlineLink: css({
      color: 'var(--tutorial-accent)',
      textDecoration: 'none',
      fontWeight: theme.typography.fontWeightMedium,
      '&:hover': {
        textDecoration: 'underline',
      },
    }),
    contentFooter: css({
      marginTop: theme.spacing(4),
      display: 'flex',
      alignItems: 'center',
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
      letterSpacing: '-0.01em',
      transition: `color ${theme.transitions.duration.short}ms ease, transform ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        textDecoration: 'underline',
        transform: 'translateX(2px)',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    signalFieldMosaic: css({
      display: 'grid',
      gap: 0,
    }),
    signalFieldTabs: css({
      display: 'flex',
      gap: 0,
      borderBottom: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
      overflowX: 'auto',
    }),
    signalFieldTab: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(0.75, 1.5),
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      borderBottom: '2px solid transparent',
      transition: `color ${signalFieldTransitionMs}ms ease, border-color ${signalFieldTransitionMs}ms ease`,
      '&:hover': {
        color: theme.colors.text.primary,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '-2px',
      },
    }),
    signalFieldTabActive: css({
      color: 'var(--tutorial-accent)',
      borderBottomColor: 'var(--tutorial-accent)',
    }),
    signalFieldTabPanel: css({
      padding: theme.spacing(1.5, 0.5, 0),
    }),
    signalFieldTabSubtitle: css({
      margin: `0 0 ${theme.spacing(1)}`,
      fontSize: '11px',
      lineHeight: 1.4,
      color: theme.colors.text.secondary,
    }),
    signalFieldList: css({
      margin: 0,
      paddingLeft: theme.spacing(2),
      listStyleType: 'disc',
      listStylePosition: 'outside',
      display: 'grid',
      gap: theme.spacing(0.5),
      '& li::marker': {
        color: 'var(--tutorial-accent)',
      },
    }),
    signalFieldListItem: css({
      display: 'list-item',
    }),
    signalFieldName: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.4,
    }),
    signalFieldType: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: '11px',
      color: theme.colors.text.secondary,
      lineHeight: 1.4,
    }),
    signalFieldDescription: css({
      margin: 0,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.4,
      color: theme.colors.text.primary,
    }),
    signalFieldDetails: css({
      fontSize: '11px',
      lineHeight: 1.4,
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
      width: '10px',
      height: '10px',
      borderRadius: '9999px',
      border: `1px solid ${theme.colors.text.secondary}`,
      opacity: 0.35,
      textDecoration: 'none',
      transition: `opacity ${theme.transitions.duration.short}ms ease, background ${theme.transitions.duration.short}ms ease, border-color ${theme.transitions.duration.short}ms ease, transform ${theme.transitions.duration.short}ms ease`,
      '&:hover': {
        opacity: 0.7,
        transform: 'scale(1.2)',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    dotActive: css({
      background: 'var(--tutorial-accent)',
      borderColor: 'var(--tutorial-accent)',
      opacity: 1,
      boxShadow: '0 0 6px var(--tutorial-accent)',
    }),
  };
}
