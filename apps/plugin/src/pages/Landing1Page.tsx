import React from 'react';
import { css } from '@emotion/css';
import { useAssistant } from '@grafana/assistant';
import type { GrafanaTheme2 } from '@grafana/data';
import { Card, LinkButton, Stack, Text, useStyles2 } from '@grafana/ui';
import { AssistantMenu } from '../components/landing/AssistantMenu';
import { LandingTopBar } from '../components/landing/LandingTopBar';

const whatIsSigilQuestions: string[] = [
  'What additional information does Sigil contain?',
  'What is the structure of the Sigil database?',
  'How does Sigil telemetry differ from standard tracing data?',
];

const ASSISTANT_ORIGIN = 'grafana/sigil-plugin/landing1';
const PRODUCT_WALKTHROUGH_VIDEO_ID = 'M7lc1UVf-VE';

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

function buildYouTubeEmbedUrl(videoId: string): string {
  const url = new URL(`/embed/${videoId}`, 'https://www.youtube.com');
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  return url.toString();
}

export default function Landing1Page() {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();

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

  const openAssistantWithQuestion = (question: string) => {
    openAssistantWithPrompt(question);
  };

  return (
    <div className={styles.page}>
      <LandingTopBar assistantOrigin={ASSISTANT_ORIGIN} />
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
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    page: css({
      width: '100%',
    }),
    sectionBlock: css({
      minWidth: 0,
      padding: theme.spacing(3),
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
    featureBulletList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
      fontSize: theme.typography.body.fontSize,
    }),
  };
}
