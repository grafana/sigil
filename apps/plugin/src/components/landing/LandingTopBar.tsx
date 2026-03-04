import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { useAssistant } from '@grafana/assistant';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Card, HorizontalGroup, IconButton, LinkButton, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { useNavigate } from 'react-router-dom';
import { defaultAgentsDataSource } from '../../agents/api';
import { defaultConversationsDataSource } from '../../conversation/api';
import { PLUGIN_BASE, ROUTES } from '../../constants';
import {
  getInstrumentationPrompt,
  getInstrumentationPromptFilename,
  type InstrumentationPromptIde,
} from '../../content/cursorInstrumentationPrompt';
import { defaultEvaluationDataSource } from '../../evaluation/api';
import { ClaudeCodeLogo, CopilotLogo, CursorLogo } from './IdeLogos';

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

type HeroStatItem = {
  label: string;
  route: string;
  cta: string;
  current: number;
  previous: number;
  loading: boolean;
};

const METRIC_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const HERO_STATS_STORAGE_KEY = 'grafana-sigil-hero-stats';
const HERO_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

type StoredHeroStats = {
  fetched_at?: number;
  conversations: { current: number; previous: number };
  agents: { current: number; previous: number };
  evaluations: { current: number; previous: number };
};

type HeroStatsCache = {
  stats: HeroStatItem[];
  fetchedAt?: number;
};

function readHeroStatsCache(): HeroStatsCache | null {
  try {
    const raw = localStorage.getItem(HERO_STATS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredHeroStats;
    if (parsed?.conversations && parsed?.agents && parsed?.evaluations) {
      return {
        fetchedAt: parsed.fetched_at,
        stats: [
          {
            label: 'Conversations',
            route: ROUTES.Conversations,
            cta: 'View conversations',
            ...parsed.conversations,
            loading: false,
          },
          {
            label: 'Agents',
            route: ROUTES.Agents,
            cta: 'Inspect agents',
            ...parsed.agents,
            loading: false,
          },
          {
            label: 'Evaluations',
            route: ROUTES.Evaluation,
            cta: 'Manage evals',
            ...parsed.evaluations,
            loading: false,
          },
        ],
      };
    }
    return null;
  } catch {
    return null;
  }
}

function loadHeroStatsFromStorage(): HeroStatItem[] | null {
  const cached = readHeroStatsCache();
  if (!cached) {
    return null;
  }
  return cached.stats;
}

export function shouldFetchHeroStats(now = Date.now()): boolean {
  const cached = readHeroStatsCache();
  if (!cached?.fetchedAt) {
    return true;
  }
  return now - cached.fetchedAt > HERO_STATS_CACHE_TTL_MS;
}

function saveHeroStatsToStorage(stats: HeroStatItem[]): void {
  try {
    const [conv, agents, evals] = stats;
    if (conv?.loading || agents?.loading || evals?.loading) {
      return;
    }
    const stored: StoredHeroStats = {
      fetched_at: Date.now(),
      conversations: { current: conv.current, previous: conv.previous },
      agents: { current: agents.current, previous: agents.previous },
      evaluations: { current: evals.current, previous: evals.previous },
    };
    localStorage.setItem(HERO_STATS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // ignore
  }
}

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

function renderIdeActionLogo(ide: IdeKey): React.ReactNode {
  if (ide === 'cursor') {
    return <CursorLogo size={20} withBackground={false} />;
  }
  if (ide === 'claudecode') {
    return <ClaudeCodeLogo size={20} />;
  }
  return <CopilotLogo size={20} />;
}

type LandingTopBarProps = {
  assistantOrigin: string;
};

export function LandingTopBar({ assistantOrigin }: LandingTopBarProps) {
  const styles = useStyles2(getStyles);
  const assistant = useAssistant();
  const navigate = useNavigate();
  const [assistantInput, setAssistantInput] = useState('');
  const [selectedIde, setSelectedIde] = useState<IdeKey>('cursor');
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [heroStats, setHeroStats] = useState<HeroStatItem[]>(() => {
    const stored = loadHeroStatsFromStorage();
    if (stored) {
      return stored;
    }
    return [
      {
        label: 'Conversations',
        route: ROUTES.Conversations,
        cta: 'View conversations',
        current: 0,
        previous: 0,
        loading: true,
      },
      { label: 'Agents', route: ROUTES.Agents, cta: 'Inspect agents', current: 0, previous: 0, loading: true },
      { label: 'Evaluations', route: ROUTES.Evaluation, cta: 'Manage evals', current: 0, previous: 0, loading: true },
    ];
  });

  const selectedIdeConfig = useMemo(() => ideTabs.find((ide) => ide.key === selectedIde) ?? ideTabs[0], [selectedIde]);
  const selectedPrompt = useMemo(() => getInstrumentationPrompt(selectedIde), [selectedIde]);
  const cursorDeeplink = useMemo(() => buildCursorPromptDeeplink(selectedPrompt), [selectedPrompt]);

  const openAssistantWithPrompt = (message: string) => {
    const prompt = message.trim();
    if (assistant.openAssistant) {
      if (prompt.length > 0) {
        assistant.openAssistant({
          origin: assistantOrigin,
          prompt,
          autoSend: true,
        });
      } else {
        assistant.openAssistant({
          origin: assistantOrigin,
        });
      }
      return;
    }

    window.location.href = buildAssistantUrl(prompt);
  };

  const openAssistant = () => {
    openAssistantWithPrompt(assistantInput);
  };

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();

    if (!shouldFetchHeroStats(now)) {
      return;
    }

    const currentFrom = new Date(now - METRIC_WINDOW_MS);
    const currentTo = new Date(now);
    const previousFrom = new Date(now - 2 * METRIC_WINDOW_MS);
    const previousTo = new Date(now - METRIC_WINDOW_MS);

    const loadStats = async () => {
      try {
        const [conversationCurrent, conversationPrevious, agentCounts, evaluatorCounts] = await Promise.all([
          countConversationsInRange(currentFrom, currentTo),
          countConversationsInRange(previousFrom, previousTo),
          countAgentsSeenInWindows(currentFrom, currentTo, previousFrom, previousTo),
          countEvaluatorsUpdatedInWindows(currentFrom, currentTo, previousFrom, previousTo),
        ]);

        if (cancelled) {
          return;
        }

        const next = [
          {
            label: 'Conversations',
            route: ROUTES.Conversations,
            cta: 'View conversations',
            current: conversationCurrent,
            previous: conversationPrevious,
            loading: false,
          },
          {
            label: 'Agents',
            route: ROUTES.Agents,
            cta: 'Inspect agents',
            current: agentCounts.current,
            previous: agentCounts.previous,
            loading: false,
          },
          {
            label: 'Evaluations',
            route: ROUTES.Evaluation,
            cta: 'Manage evals',
            current: evaluatorCounts.current,
            previous: evaluatorCounts.previous,
            loading: false,
          },
        ];
        setHeroStats(next);
        saveHeroStatsToStorage(next);
      } catch {
        if (cancelled) {
          return;
        }
        // Fall back to the existing values so the hero stats do not stay in a loading state forever.
        setHeroStats((prev) => prev.map((item) => ({ ...item, loading: false })));
      }
    };

    void loadStats();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
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
                  {heroStats.map((item) => (
                    <li key={item.label}>
                      <button
                        type="button"
                        className={styles.heroStatLink}
                        onClick={() => void navigate(`${PLUGIN_BASE}/${item.route}`)}
                      >
                        <span className={styles.heroStatLabel}>{item.label}</span>
                        <span className={styles.heroStatRow}>
                          <span className={styles.heroStatValue}>
                            {item.loading ? '...' : item.current.toLocaleString()}
                          </span>
                          {!item.loading && (
                            <ComparisonBadge current={item.current} previous={item.previous} styles={styles} />
                          )}
                        </span>
                        <span className={styles.heroStatCta}>{item.cta}</span>
                      </button>
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
                  aria-label="Send"
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
    </>
  );
}

function ComparisonBadge({
  current,
  previous,
  styles,
}: {
  current: number;
  previous: number;
  styles: ReturnType<typeof getStyles>;
}) {
  if (previous === 0 && current === 0) {
    return (
      <Tooltip content="No change from previous window" placement="bottom">
        <span className={`${styles.changeBadge} ${styles.changeBadgeNeutral}`}>→ 0%</span>
      </Tooltip>
    );
  }

  if (previous === 0) {
    return null;
  }

  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  const isUp = pctChange > 0;
  const arrow = pctChange === 0 ? '→' : isUp ? '↑' : '↓';
  const sign = isUp ? '+' : '';
  const badgeClass =
    pctChange === 0 ? styles.changeBadgeNeutral : isUp ? styles.changeBadgeGood : styles.changeBadgeWarn;
  const tooltipText = `${previous.toLocaleString()} in previous window`;
  return (
    <Tooltip content={tooltipText} placement="bottom">
      <span className={`${styles.changeBadge} ${badgeClass}`}>
        {arrow} {sign}
        {pctChange.toFixed(1)}%
      </span>
    </Tooltip>
  );
}

async function countConversationsInRange(from: Date, to: Date): Promise<number> {
  let cursor = '';
  let total = 0;
  let pages = 0;
  while (pages < MAX_PAGES) {
    const response = await defaultConversationsDataSource.searchConversations({
      filters: '',
      select: [],
      time_range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      page_size: PAGE_SIZE,
      cursor: cursor.length > 0 ? cursor : undefined,
    });
    total += response.conversations.length;
    if (!response.has_more || !response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return total;
}

type WindowCounts = {
  current: number;
  previous: number;
};

function countInWindows(
  timestamps: number[],
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date
): WindowCounts {
  const currentMin = currentFrom.getTime();
  const currentMax = currentTo.getTime();
  const previousMin = previousFrom.getTime();
  const previousMax = previousTo.getTime();
  let current = 0;
  let previous = 0;

  for (const timestamp of timestamps) {
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    if (timestamp >= currentMin && timestamp <= currentMax) {
      current += 1;
      continue;
    }
    if (timestamp >= previousMin && timestamp <= previousMax) {
      previous += 1;
    }
  }

  return { current, previous };
}

async function listAgentSeenTimestamps(): Promise<number[]> {
  let cursor = '';
  let pages = 0;
  const timestamps: number[] = [];
  while (pages < MAX_PAGES) {
    const response = await defaultAgentsDataSource.listAgents(PAGE_SIZE, cursor);
    for (const item of response.items ?? []) {
      timestamps.push(Date.parse(item.latest_seen_at));
    }
    if (!response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return timestamps;
}

async function listEvaluatorUpdatedTimestamps(): Promise<number[]> {
  let cursor = '';
  let pages = 0;
  const timestamps: number[] = [];
  while (pages < MAX_PAGES) {
    const response = await defaultEvaluationDataSource.listEvaluators(PAGE_SIZE, cursor);
    for (const item of response.items ?? []) {
      timestamps.push(Date.parse(item.updated_at));
    }
    if (!response.next_cursor) {
      break;
    }
    cursor = response.next_cursor;
    pages += 1;
  }
  return timestamps;
}

export async function countAgentsSeenInWindows(
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date
): Promise<WindowCounts> {
  const timestamps = await listAgentSeenTimestamps();
  return countInWindows(timestamps, currentFrom, currentTo, previousFrom, previousTo);
}

async function countEvaluatorsUpdatedInWindows(
  currentFrom: Date,
  currentTo: Date,
  previousFrom: Date,
  previousTo: Date
): Promise<WindowCounts> {
  const timestamps = await listEvaluatorUpdatedTimestamps();
  return countInWindows(timestamps, currentFrom, currentTo, previousFrom, previousTo);
}

function getStyles(theme: GrafanaTheme2) {
  return {
    pageFlow: css({
      label: 'landingTopBar-pageFlow',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(400px, 480px)',
      alignItems: 'stretch',
      gap: theme.spacing(3),
      boxSizing: 'border-box',
      '@media (max-width: 1200px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    heroBlock: css({
      label: 'landingTopBar-heroBlock',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
    }),
    heroSideHeaderBlock: css({
      label: 'landingTopBar-heroSideHeaderBlock',
      position: 'sticky',
      top: theme.spacing(2),
      alignSelf: 'stretch',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      gap: theme.spacing(3),
      minHeight: 0,
      '@media (max-width: 1200px)': {
        position: 'static',
      },
    }),
    heroSideActions: css({
      label: 'landingTopBar-heroSideActions',
      margin: 0,
    }),
    heroSideCard: css({
      label: 'landingTopBar-heroSideCard',
      height: '100%',
      minHeight: 0,
    }),
    sideCardMutedHeading: css({
      label: 'landingTopBar-sideCardMutedHeading',
      margin: 0,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontSize: theme.typography.h6.fontSize,
      lineHeight: theme.typography.h6.lineHeight,
      fontWeight: theme.typography.fontWeightBold,
    }),
    heroCard: css({
      label: 'landingTopBar-heroCard',
      position: 'relative',
      flex: 1,
      minHeight: 0,
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
      label: 'landingTopBar-introducingLabel',
      marginTop: theme.spacing(1),
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.1,
      color: '#5794F2',
    }),
    heroHeader: css({
      label: 'landingTopBar-heroHeader',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'start',
      gap: theme.spacing(2),
      '@media (max-width: 900px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    heroLearnMoreList: css({
      label: 'landingTopBar-heroLearnMoreList',
      margin: 0,
      paddingLeft: 0,
      listStyle: 'none',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))',
      gap: theme.spacing(0.5),
      justifySelf: 'end',
      alignSelf: 'center',
      width: '100%',
      '@media (max-width: 900px)': {
        gridTemplateColumns: '1fr',
        justifySelf: 'start',
      },
    }),
    heroStatLink: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      width: '100%',
      border: 0,
      background: 'none',
      padding: theme.spacing(0.5, 0.75),
      borderRadius: theme.shape.radius.default,
      textAlign: 'right',
      cursor: 'pointer',
      '&:hover': {
        background: theme.colors.action.hover,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: 2,
      },
    }),
    heroStatLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightRegular,
      lineHeight: 1.2,
    }),
    heroStatRow: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(1),
    }),
    heroStatValue: css({
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.h3.fontSize,
      lineHeight: 1.2,
    }),
    heroStatCta: css({
      color: theme.colors.text.link,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.2,
    }),
    changeBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(0.25, 1),
      borderRadius: 999,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
      textDecoration: 'none',
    }),
    changeBadgeGood: css({
      color: theme.colors.success.text,
      border: `1px solid ${theme.colors.success.border}`,
      background: theme.colors.success.transparent,
    }),
    changeBadgeWarn: css({
      color: theme.colors.warning.text,
      border: `1px solid ${theme.colors.warning.border}`,
      background: theme.colors.warning.transparent,
    }),
    changeBadgeNeutral: css({
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      background: 'transparent',
    }),
    productHeading: css({
      label: 'landingTopBar-productHeading',
      margin: 0,
      fontFamily: theme.typography.fontFamily,
      fontWeight: theme.typography.fontWeightBold,
      fontSize: '2.2rem',
      lineHeight: 1.1,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
    }),
    assistantRowDash: css({
      label: 'landingTopBar-assistantRowDash',
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
      label: 'landingTopBar-assistantInput',
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
      label: 'landingTopBar-askSubmitButton',
      backgroundColor: theme.colors.action.hover,
      padding: theme.spacing(0.5),
      borderRadius: theme.shape.radius.circle,
      alignSelf: 'end',
      '&:hover::before': {
        borderRadius: theme.shape.radius.circle,
      },
      transition: 'all 0.2s ease-in-out',
    }),
    bulletList: css({
      label: 'landingTopBar-bulletList',
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
    }),
    ideTabs: css({
      label: 'landingTopBar-ideTabs',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: theme.spacing(1),
    }),
    ideTabButton: css({
      label: 'landingTopBar-ideTabButton',
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
      label: 'landingTopBar-ideTabLogo',
      display: 'inline-flex',
      alignItems: 'center',
    }),
    modalBackdrop: css({
      label: 'landingTopBar-modalBackdrop',
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
      label: 'landingTopBar-modalCard',
      width: '100%',
      maxWidth: 760,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      padding: theme.spacing(3),
      boxShadow: theme.shadows.z3,
    }),
    promptPreview: css({
      label: 'landingTopBar-promptPreview',
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
      label: 'landingTopBar-promptSummaryRow',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'start',
      gap: theme.spacing(1),
    }),
    promptContent: css({
      label: 'landingTopBar-promptContent',
      display: 'grid',
      gap: theme.spacing(1),
    }),
    promptIconActions: css({
      label: 'landingTopBar-promptIconActions',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(0.75),
    }),
    promptIconButton: css({
      label: 'landingTopBar-promptIconButton',
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
      label: 'landingTopBar-modalActionRow',
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-end',
    }),
    instrumentButtonLogo: css({
      label: 'landingTopBar-instrumentButtonLogo',
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
