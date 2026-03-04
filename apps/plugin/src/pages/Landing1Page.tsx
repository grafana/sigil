import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { useAssistant } from '@grafana/assistant';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Card, HorizontalGroup, IconButton, Link, LinkButton, Stack, Text, useStyles2 } from '@grafana/ui';
import { AssistantMenu } from '../components/landing/AssistantMenu';
import {
  getInstrumentationPrompt,
  getInstrumentationPromptFilename,
  type InstrumentationPromptIde,
} from '../content/cursorInstrumentationPrompt';
import { ClaudeCodeLogo, CopilotLogo, CursorLogo } from '../components/landing/IdeLogos';

type IdeKey = InstrumentationPromptIde;

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
    blurb: 'Have Claude Code help add Sigil instrumentation to your code.',
    tips: [],
  },
  {
    key: 'copilot',
    label: 'Copilot',
    logo: <CopilotLogo />,
    blurb: 'Have Copilot help add Sigil instrumentation to your code.',
    tips: [],
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
const PRODUCT_WALKTHROUGH_VIDEO_ID = 'M7lc1UVf-VE';

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

function buildYouTubeEmbedUrl(videoId: string): string {
  const url = new URL(`/embed/${videoId}`, 'https://www.youtube.com');
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  return url.toString();
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

function renderIdeActionLogo(ide: IdeKey): React.ReactNode {
  if (ide === 'cursor') {
    return <CursorLogo size={20} withBackground={false} />;
  }
  if (ide === 'claudecode') {
    return <ClaudeCodeLogo size={20} />;
  }
  return <CopilotLogo size={20} />;
}

export default function Landing1Page() {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();
  const [assistantInput, setAssistantInput] = useState('');
  const [selectedIde, setSelectedIde] = useState<IdeKey>('cursor');
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const selectedIdeConfig = useMemo(() => ideTabs.find((ide) => ide.key === selectedIde) ?? ideTabs[0], [selectedIde]);
  const selectedPrompt = useMemo(() => getInstrumentationPrompt(selectedIde), [selectedIde]);

  const cursorDeeplink = useMemo(() => buildCursorPromptDeeplink(selectedPrompt), [selectedPrompt]);

  const openAssistantWithPrompt = (message: string) => {
    const prompt = message.trim();
    if (assistant.openAssistant) {
      if (prompt.length > 0) {
        assistant.openAssistant({
          origin: ASSISTANT_ORIGIN,
          prompt,
          autoSend: true,
        });
      } else {
        assistant.openAssistant({
          origin: ASSISTANT_ORIGIN,
        });
      }
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
      <div className={styles.pageFlow}>
        <div className={styles.heroBlock}>
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
              <form className={styles.assistantRowDash}>
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
                  type="button"
                />
              </form>
            </Stack>
          </div>
        </div>

        <div className={styles.heroSideHeaderBlock}>
          <HorizontalGroup className={styles.heroSideActions}>
            <LinkButton href={buildFakeDocUrl('/sigil/get-started')} icon="book-open" target="_blank" rel="noreferrer">
              Read docs
            </LinkButton>
            <LinkButton href={buildFakeDocUrl('/sigil/overview')} variant="secondary" target="_blank" rel="noreferrer">
              Learn more
            </LinkButton>
          </HorizontalGroup>
          <Card className={styles.heroSideCard}>
            <Stack direction="column" gap={2}>
              <div className={styles.sideCardMutedHeading}>
                <Text color="secondary">AUTOINSTRUMENTATION</Text>
              </div>
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
        </div>

        <div className={styles.sectionBlock}>
          <div className={styles.lowerSectionsGrid}>
            <Card className={styles.lowerSectionCard}>
              <Stack direction="column" gap={2}>
                <Text element="h3">Product walkthrough video</Text>
                <div className={styles.videoFrameWrapper}>
                  <iframe
                    className={styles.videoFrame}
                    src={buildYouTubeEmbedUrl(PRODUCT_WALKTHROUGH_VIDEO_ID)}
                    title="Sigil product walkthrough video"
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              </Stack>
            </Card>

            <Card className={styles.lowerSectionCard}>
              <Stack direction="column" gap={2}>
                <Text element="h3">What is Sigil?</Text>
                <ul className={styles.featureBulletList}>
                  <li>New telemetry signal for AI</li>
                  <li>New database to efficiently work with the new signal</li>
                  <li>New UX</li>
                  <li>AX (Agent eXperience) native - works with AI agents out of the box</li>
                </ul>
                <LinkButton
                  href={buildFakeDocUrl('/sigil/concepts')}
                  variant="secondary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Explore concepts
                </LinkButton>
              </Stack>
            </Card>

            <Card className={styles.lowerSectionCard}>
              <Stack direction="column" gap={2}>
                <AssistantMenu
                  className={styles.askAssistantMenu}
                  questions={whatIsSigilQuestions}
                  onAsk={openAssistantWithQuestion}
                />
              </Stack>
            </Card>
          </div>
        </div>
      </div>

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
              <Text>{selectedIdeConfig.blurb}</Text>
              {selectedIdeConfig.tips.length > 0 && (
                <ul className={styles.bulletList}>
                  {selectedIdeConfig.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
              <div className={styles.promptSummaryRow}>
                <div className={styles.promptContent}>
                  <pre className={styles.promptPreview}>
                    <code>{selectedPrompt}</code>
                  </pre>
                </div>
                <div className={styles.promptIconActions}>
                  <IconButton
                    name="download-alt"
                    variant="secondary"
                    aria-label="Download prompt file"
                    tooltip="Download prompt as a markdown file"
                    className={styles.promptIconButton}
                    onClick={() => downloadTextFile(getInstrumentationPromptFilename(selectedIde), selectedPrompt)}
                  />
                  <IconButton
                    name="copy"
                    variant="secondary"
                    aria-label="Copy prompt to clipboard"
                    tooltip="Copy prompt to your clipboard"
                    className={styles.promptIconButton}
                    onClick={() => void navigator.clipboard.writeText(selectedPrompt)}
                  />
                </div>
              </div>
              <HorizontalGroup justify="flex-end" className={styles.modalActionRow}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (selectedIde === 'cursor') {
                      window.open(cursorDeeplink, '_blank', 'noopener');
                      return;
                    }
                    void navigator.clipboard.writeText(selectedPrompt);
                  }}
                >
                  <span className={styles.instrumentButtonLogo}>{renderIdeActionLogo(selectedIde)}</span>
                  {selectedIde === 'cursor' ? 'Instrument in Cursor' : 'Copy prompt'}
                </Button>
              </HorizontalGroup>
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
      width: '100%',
    }),
    pageFlow: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 380px)',
      alignItems: 'start',
      gap: theme.spacing(3),
      padding: theme.spacing(0, 3),
      boxSizing: 'border-box',
      '@media (max-width: 1200px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    heroBlock: css({
      minWidth: 0,
    }),
    sectionBlock: css({
      gridColumn: '1 / -1',
      minWidth: 0,
    }),
    lowerSectionsGrid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: theme.spacing(2),
      alignItems: 'stretch',
    }),
    lowerSectionCard: css({
      height: '100%',
    }),
    heroSideHeaderBlock: css({
      position: 'sticky',
      top: theme.spacing(2),
      alignSelf: 'stretch',
      display: 'grid',
      gap: theme.spacing(1),
      '@media (max-width: 1200px)': {
        position: 'static',
      },
    }),
    heroSideActions: css({
      margin: 0,
    }),
    heroSideCard: css({
      height: '100%',
    }),
    sideCardMutedHeading: css({
      margin: 0,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontSize: theme.typography.h6.fontSize,
      lineHeight: theme.typography.h6.lineHeight,
      fontWeight: theme.typography.fontWeightBold,
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
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(0.5),
      justifySelf: 'end',
      alignSelf: 'center',
      '& li::marker': {
        color: '#5794F2',
        fontSize: '1.15em',
      },
      '& li:nth-of-type(2)::marker': {
        color: '#7D86EA',
      },
      '& li:nth-of-type(3)::marker': {
        color: '#B877D9',
      },
      '& li:nth-of-type(4)::marker': {
        color: '#FF9830',
      },
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
      paddingRight: 0,
      paddingTop: theme.spacing(0.75),
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
    askAssistantMenu: css({
      width: '100%',
      minWidth: 0,
      marginTop: 0,
    }),
    videoFrameWrapper: css({
      width: '100%',
      aspectRatio: '16 / 9',
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.secondary,
    }),
    videoFrame: css({
      width: '100%',
      height: '100%',
      border: 0,
      display: 'block',
    }),
    bulletList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
    }),
    featureBulletList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
      fontSize: theme.typography.body.fontSize,
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
    promptContent: css({
      display: 'grid',
      gap: theme.spacing(1),
    }),
    promptIconActions: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(0.75),
    }),
    promptIconButton: css({
      width: 32,
      height: 32,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      color: theme.colors.text.secondary,
      '&:hover': {
        borderColor: theme.colors.border.medium,
        background: theme.colors.action.hover,
      },
      '&:focus-visible': {
        boxShadow: `0 0 0 2px ${theme.colors.primary.main}`,
      },
    }),
    modalActionRow: css({
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-end',
    }),
    instrumentButtonLogo: css({
      display: 'inline-flex',
      alignItems: 'center',
      marginRight: theme.spacing(0.5),
      '& svg': {
        width: 20,
        height: 20,
      },
    }),
  };
}
