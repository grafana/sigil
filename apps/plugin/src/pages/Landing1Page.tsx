import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { useAssistant } from '@grafana/assistant';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Card, HorizontalGroup, IconButton, Link, LinkButton, Stack, Text, useStyles2 } from '@grafana/ui';
import { AssistantMenu } from '../components/landing/AssistantMenu';
import { CURSOR_PROMPT_FILENAME, cursorInstrumentationPrompt } from '../content/cursorInstrumentationPrompt';
import { ClaudeCodeLogo, CopilotLogo, CursorLogo } from '../components/landing/IdeLogos';

type IdeKey = 'cursor' | 'claudecode' | 'copilot';

type IdeTab = {
  key: IdeKey;
  label: string;
  logo: React.ReactNode;
  blurb: string;
  tips: string[];
};

const ideTabs: IdeTab[] = [
  {
    key: 'cursor',
    label: 'Cursor',
    logo: <CursorLogo />,
    blurb: 'Have Cursor help add Sigil instrumentation to your code.',
    tips: [],
  },
  {
    key: 'claudecode',
    label: 'Claude Code',
    logo: <ClaudeCodeLogo />,
    blurb: 'Great for deeper codebase analysis before making instrumentation edits.',
    tips: [
      'Ask for all current LLM or provider call-sites.',
      'Prioritize paths with highest traffic and error rates.',
      'Request tests for new telemetry mappings.',
    ],
  },
  {
    key: 'copilot',
    label: 'Copilot',
    logo: <CopilotLogo />,
    blurb: 'Use inline suggestions to add Sigil fields as you touch AI-heavy files.',
    tips: [
      'Prompt against a single file for focused suggestions.',
      'Keep naming aligned with existing telemetry attributes.',
      'Use PR summaries to explain observability impact.',
    ],
  },
];

const whatIsSigilQuestions: string[] = [
  'What additional information does Sigil contain?',
  'What is the structure of the Sigil database?',
  'How does Sigil telemetry differ from standard tracing data?',
];

type HeroLearnMoreItem = {
  label: string;
  href: string;
};

const ASSISTANT_ORIGIN = 'grafana/sigil-plugin/landing1';

const heroLearnMoreItems: HeroLearnMoreItem[] = [
  { label: 'New telemetry signal', href: '/sigil/concepts/telemetry-signal' },
  { label: 'New OSS and Cloud database', href: '/sigil/concepts/database' },
  { label: 'New experience', href: '/sigil/overview' },
  { label: 'Agent native', href: '/sigil/concepts/agent-experience' },
];

function buildFakeDocUrl(pathname: string): string {
  return new URL(pathname, 'https://docs.example.com').toString();
}

function buildAssistantUrl(message: string): string {
  const url = new URL('/a/grafana-assistant-app', window.location.origin);
  url.searchParams.set('command', 'useAssistant');
  if (message.trim().length > 0) {
    url.searchParams.set('text', message.trim());
  }
  return url.toString();
}

function buildCursorPromptDeeplink(promptText: string): string {
  const deeplink = new URL('https://cursor.com/link/prompt');
  deeplink.searchParams.set('text', promptText);
  return deeplink.toString();
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function Landing1Page() {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();
  const [assistantInput, setAssistantInput] = useState('');
  const [selectedIde, setSelectedIde] = useState<IdeKey>('cursor');
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const selectedIdeConfig = useMemo(() => ideTabs.find((ide) => ide.key === selectedIde) ?? ideTabs[0], [selectedIde]);

  const cursorDeeplink = useMemo(() => buildCursorPromptDeeplink(cursorInstrumentationPrompt), []);

  const openAssistantWithPrompt = (message: string) => {
    const prompt = message.trim();
    if (prompt.length === 0) {
      return;
    }

    if (assistant.openAssistant) {
      assistant.openAssistant({
        origin: ASSISTANT_ORIGIN,
        prompt,
        autoSend: true,
      });
      return;
    }

    window.location.href = buildAssistantUrl(prompt);
  };

  const openAssistant = () => {
    openAssistantWithPrompt(assistantInput);
  };

  const openAssistantWithQuestion = (question: string) => {
    openAssistantWithPrompt(question);
  };

  return (
    <div className={styles.page}>
      <Stack direction="column" gap={4}>
        <div className={styles.heroCard}>
          <Stack direction="column" gap={2}>
            <div className={styles.heroHeader}>
              <div>
                <div className={styles.introducingLabel}>Introducing</div>
                <h1 className={styles.productHeading}>Grafana Sigil</h1>
                <Text color="secondary">Actually useful AI O11y</Text>
              </div>
              <ul className={styles.heroLearnMoreList}>
                {heroLearnMoreItems.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={buildFakeDocUrl(item.href)}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.heroLearnMoreLink}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <form
              className={styles.assistantRowDash}
              onSubmit={(event) => {
                event.preventDefault();
                openAssistant();
              }}
            >
              <textarea
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.currentTarget.value)}
                placeholder="Ask me anything about Sigil"
                className={styles.assistantInput}
                rows={3}
              />
              <IconButton
                name="enter"
                variant="secondary"
                size="lg"
                aria-label="Send assistant prompt"
                tooltip="Send"
                className={styles.askSubmitButton}
                disabled={assistantInput.trim().length === 0}
                onClick={openAssistant}
                type="submit"
              />
            </form>
          </Stack>
        </div>
        <HorizontalGroup>
          <LinkButton href={buildFakeDocUrl('/sigil/get-started')} icon="book-open" target="_blank" rel="noreferrer">
            Read docs
          </LinkButton>
          <LinkButton href={buildFakeDocUrl('/sigil/overview')} variant="secondary" target="_blank" rel="noreferrer">
            Learn more
          </LinkButton>
        </HorizontalGroup>

        <Card>
          <Stack direction="column" gap={2}>
            <Text element="h3">Instrument your code now</Text>
            <Text color="secondary">
              Use our coding agent skill to instrument your codebase. Then select coding agent.
            </Text>
            <div className={styles.ideTabs}>
              {ideTabs.map((ide) => (
                <button
                  key={ide.key}
                  type="button"
                  className={styles.ideTabButton}
                  onClick={() => {
                    setSelectedIde(ide.key);
                    setIsAgentModalOpen(true);
                  }}
                  aria-label={`Open ${ide.label} instrumentation details`}
                >
                  <span className={styles.ideTabLogo}>{ide.logo}</span>
                  <span>{ide.label}</span>
                </button>
              ))}
            </div>
          </Stack>
        </Card>

        <div className={styles.fullBleedSection}>
          <Card className={styles.fullBleedCard}>
            <div className={styles.videoPlaceholder}>
              <Text element="h4">Product walkthrough video</Text>
              <Text color="secondary">Coming soon</Text>
            </div>
          </Card>
        </div>

        <div className={styles.sectionWithAssistantMenu}>
          <Card>
            <Stack direction="column" gap={2}>
              <Text element="h3">What is Sigil?</Text>
              <ul className={styles.bulletList}>
                <li>New telemetry signal for AI</li>
                <li>New database to efficiently work with the new signal</li>
                <li>New UX</li>
                <li>AX (Agent eXperience) native - works with AI agents out of the box</li>
              </ul>
              <LinkButton href={buildFakeDocUrl('/sigil/concepts')} variant="secondary" target="_blank" rel="noreferrer">
                Explore concepts
              </LinkButton>
            </Stack>
          </Card>
          <AssistantMenu
            className={styles.sectionAssistantMenu}
            questions={whatIsSigilQuestions}
            onAsk={openAssistantWithQuestion}
          />
        </div>

        <Card>
          <Stack direction="column" gap={1}>
            <Text element="h4">Suggested additions</Text>
            <ul className={styles.bulletList}>
              <li>Interactive architecture diagram showing signal flow from SDK to query UX.</li>
              <li>Mini benchmark strip with latency, cost, and quality deltas.</li>
              <li>Live sample query playground for first-time users.</li>
            </ul>
          </Stack>
        </Card>
      </Stack>

      {isAgentModalOpen && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setIsAgentModalOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedIdeConfig.label} instrumentation`}
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <Stack direction="column" gap={2}>
              <HorizontalGroup justify="space-between">
                <Text element="h4">{selectedIdeConfig.label}</Text>
                <Button variant="secondary" size="sm" onClick={() => setIsAgentModalOpen(false)}>
                  Close
                </Button>
              </HorizontalGroup>
              {selectedIde === 'cursor' ? (
                <>
                  <Text>Have Cursor help add Sigil instrumentation to your code.</Text>
                  <Text color="secondary">
                    We have pre-written the prompt, view it below and click &#39;Instrument in Cursor&#39; to begin.
                  </Text>
                </>
              ) : (
                <>
                  <Text>{selectedIdeConfig.blurb}</Text>
                  <ul className={styles.bulletList}>
                    {selectedIdeConfig.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </>
              )}
              {selectedIde === 'cursor' ? (
                <>
                  <div className={styles.promptSummaryRow}>
                    <details className={styles.promptDisclosure}>
                      <summary className={styles.promptSummary}>View pre-written prompt</summary>
                      <pre className={styles.promptPreview}>
                        <code>{cursorInstrumentationPrompt}</code>
                      </pre>
                    </details>
                    <IconButton
                      name="download-alt"
                      aria-label="Download prompt file"
                      tooltip="Download prompt file"
                      onClick={() => downloadTextFile(CURSOR_PROMPT_FILENAME, cursorInstrumentationPrompt)}
                    />
                  </div>
                  <HorizontalGroup>
                    <Button
                      icon="copy"
                      variant="secondary"
                      onClick={() => void navigator.clipboard.writeText(cursorInstrumentationPrompt)}
                    >
                      Copy prompt
                    </Button>
                    <Button
                      variant="primary"
                      icon="external-link-alt"
                      onClick={() => window.open(cursorDeeplink, '_blank', 'noopener')}
                    >
                      Instrument
                    </Button>
                  </HorizontalGroup>
                </>
              ) : (
                <LinkButton
                  href={buildFakeDocUrl(`/sigil/ide-guides/${selectedIde}`)}
                  target="_blank"
                  rel="noreferrer"
                  variant="secondary"
                >
                  Read {selectedIdeConfig.label} guide
                </LinkButton>
              )}
            </Stack>
          </div>
        </div>
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    page: css({
      maxWidth: 1120,
      margin: '0 auto',
    }),
    fullBleedSection: css({
      width: '100vw',
      marginLeft: 'calc(50% - 50vw)',
      marginRight: 'calc(50% - 50vw)',
      paddingLeft: theme.spacing(3),
      paddingRight: theme.spacing(3),
      boxSizing: 'border-box',
    }),
    fullBleedCard: css({
      width: '100%',
    }),
    heroCard: css({
      position: 'relative',
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      paddingTop: theme.spacing(2),
      paddingLeft: theme.spacing(3),
      paddingRight: theme.spacing(3),
      background: `linear-gradient(135deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        borderTopLeftRadius: theme.shape.radius.default,
        borderTopRightRadius: theme.shape.radius.default,
        background: 'linear-gradient(90deg, #5794F2 0%, #B877D9 52%, #FF9830 100%)',
      },
    }),
    introducingLabel: css({
      marginTop: theme.spacing(1),
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.1,
      color: '#5794F2',
    }),
    heroHeader: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'start',
      gap: theme.spacing(2),
      '@media (max-width: 900px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    heroLearnMoreList: css({
      margin: 0,
      paddingLeft: theme.spacing(2.5),
      display: 'grid',
      gap: theme.spacing(0.5),
      justifySelf: 'end',
      alignSelf: 'center',
      '@media (max-width: 900px)': {
        justifySelf: 'start',
      },
    }),
    heroLearnMoreLink: css({
      color: theme.colors.text.link,
      fontSize: theme.typography.bodySmall.fontSize,
      '&:hover': {
        textDecoration: 'underline',
      },
    }),
    productHeading: css({
      margin: 0,
      fontFamily: theme.typography.fontFamily,
      fontWeight: theme.typography.fontWeightBold,
      fontSize: '2.2rem',
      lineHeight: 1.1,
      color: theme.colors.text.primary,
    }),
    assistantRowDash: css({
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: theme.spacing(1),
      width: `calc(100% + ${theme.spacing(6)})`,
      marginLeft: theme.spacing(-3),
      marginRight: theme.spacing(-3),
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(-2),
      alignItems: 'start',
      minHeight: 96,
      borderTop: `1px solid ${theme.colors.border.medium}`,
      paddingTop: theme.spacing(0.75),
      paddingRight: theme.spacing(3),
      paddingBottom: theme.spacing(4.5),
      paddingLeft: theme.spacing(3),
      background: theme.colors.background.secondary,
    }),
    assistantInput: css({
      width: '100%',
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      paddingLeft: 0,
      paddingTop: theme.spacing(2),
      paddingBottom: 0,
      minHeight: 56,
      maxHeight: 128,
      resize: 'none',
      overflowY: 'auto',
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.h6.fontSize,
      lineHeight: theme.typography.h6.lineHeight,
      color: theme.colors.text.primary,
      '&::placeholder': {
        color: theme.colors.text.secondary,
      },
      '&:focus': {
        outline: 'none',
        boxShadow: 'none',
      },
    }),
    askSubmitButton: css({
      backgroundColor: theme.colors.action.hover,
      padding: theme.spacing(0.5),
      borderRadius: theme.shape.radius.circle,
      alignSelf: 'end',
      '&:hover::before': {
        borderRadius: theme.shape.radius.circle,
      },
      transition: 'all 0.2s ease-in-out',
    }),
    videoPlaceholder: css({
      width: '100%',
      boxSizing: 'border-box',
      minHeight: 220,
      border: `1px dashed ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      textAlign: 'center',
      gap: theme.spacing(1),
      background: theme.colors.background.secondary,
    }),
    sectionWithAssistantMenu: css({
      position: 'relative',
      paddingBottom: theme.spacing(9),
    }),
    sectionAssistantMenu: css({
      position: 'absolute',
      right: theme.spacing(2),
      bottom: 0,
      zIndex: 2,
      maxWidth: 'calc(100% - 16px)',
    }),
    bulletList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
    }),
    ideBody: css({
      border: `1px solid ${theme.colors.border.medium}`,
      borderLeft: '3px solid #5794F2',
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      display: 'grid',
      gap: theme.spacing(2),
    }),
    ideTabs: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: theme.spacing(1),
    }),
    ideTabButton: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(1),
      cursor: 'pointer',
    }),
    ideTabLogo: css({
      display: 'inline-flex',
      alignItems: 'center',
    }),
    modalBackdrop: css({
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 8, 13, 0.56)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999,
      padding: theme.spacing(2),
    }),
    modalCard: css({
      width: '100%',
      maxWidth: 760,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      padding: theme.spacing(3),
      boxShadow: theme.shadows.z3,
    }),
    promptPreview: css({
      margin: 0,
      maxHeight: 280,
      overflowY: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      padding: theme.spacing(1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      '& code': {
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    promptSummaryRow: css({
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'start',
      gap: theme.spacing(1),
    }),
    promptDisclosure: css({
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      '&[open]': {
        paddingBottom: theme.spacing(1),
      },
    }),
    promptSummary: css({
      cursor: 'pointer',
      listStyle: 'none',
      padding: theme.spacing(1.25, 1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      '&::-webkit-details-marker': {
        display: 'none',
      },
      '&::before': {
        content: '"▸ "',
      },
      'details[open] &::before': {
        content: '"▾ "',
      },
    }),
  };
}
