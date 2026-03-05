import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Badge, Button, Icon, Select, Spinner, Text, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import { defaultAgentsDataSource, type AgentsDataSource } from '../agents/api';
import type { AgentDetail, AgentRatingResponse, AgentVersionListItem } from '../agents/types';
import ModelCardPopover from '../components/conversations/ModelCardPopover';
import { getProviderColor, getProviderMeta, stripProviderPrefix } from '../components/conversations/providerMeta';
import ToolsPanel from '../components/agents/ToolsPanel';
import AgentRatingPanel from '../components/agents/AgentRatingPanel';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import type { ModelCard } from '../modelcard/types';
import { resolveModelCardsFromNames } from '../modelcard/resolve';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { formatDateShort } from '../utils/date';
import { defaultDashboardDataSource, type DashboardDataSource } from '../dashboard/api';
import { computeRateInterval, computeStep, requestsOverTimeQuery } from '../dashboard/queries';
import type { PrometheusMatrixResult, PrometheusQueryResponse } from '../dashboard/types';
import { TokenizedText } from '../components/tokenizer/TokenizedText';
import { useTokenizer } from '../components/tokenizer/useTokenizer';
import { getEncoding, AVAILABLE_ENCODINGS, type EncodingName } from '../components/tokenizer/encodingMap';
import { getTokenizeControlStyles } from '../components/tokenizer/tokenizeControls.styles';
import { TopStat } from '../components/TopStat';

const VERSION_PAGE_SIZE = 50;
const ACTIVITY_BAR_COUNT = 48;
const ACTIVITY_REFRESH_MS = 70 * 1000;
const EMPTY_ACTIVITY_BARS = Array.from({ length: ACTIVITY_BAR_COUNT }, () => 0);
const LOAD_MORE_VERSIONS_VALUE = '__load_more_versions__';

export type AgentDetailPageProps = {
  dataSource?: AgentsDataSource;
  modelCardClient?: ModelCardClient;
  activityDataSource?: DashboardDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    minHeight: 0,
    marginTop: theme.spacing(-4),
  }),
  heroStack: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
  }),
  heroPanel: css({
    position: 'relative' as const,
    borderRadius: theme.shape.radius.default,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    border: `1px solid ${theme.colors.border.weak}`,
    background: `linear-gradient(135deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
    overflow: 'hidden',
    '&::before': {
      content: '""',
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      background: 'linear-gradient(90deg, #5794F2 0%, #B877D9 52%, #FF9830 100%)',
    },
  }),
  heroTopRightRating: css({
    position: 'absolute' as const,
    top: 8,
    right: 10,
    zIndex: 2,
  }),
  heroActivityTop: css({
    borderTopLeftRadius: theme.shape.radius.default,
    borderTopRightRadius: theme.shape.radius.default,
    overflow: 'hidden',
    background: 'transparent',
  }),
  heroActivityBars: css({
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    height: 28,
    padding: 0,
    opacity: 0.85,
  }),
  heroActivityBarSlot: css({
    flex: 1,
    minWidth: 2,
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
  }),
  heroActivityBar: css({
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
    transformOrigin: 'bottom',
    transition: 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
  }),
  heroPanelBody: css({
    position: 'relative' as const,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: theme.spacing(2),
    padding: theme.spacing(2, 2, 2.5, 2),
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  }),
  heroGlow: css({
    pointerEvents: 'none' as const,
    position: 'absolute' as const,
    width: 240,
    height: 240,
    right: -60,
    top: -90,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(87,148,242,0.24) 0%, rgba(87,148,242,0) 65%)',
  }),
  heroTitleRow: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(2),
    flexWrap: 'wrap' as const,
  }),
  heroTitleMeta: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  heroEyebrow: css({
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontSize: theme.typography.bodySmall.fontSize,
    color: '#5794F2',
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.2,
  }),
  heroBackButton: css({
    marginTop: theme.spacing(0.25),
  }),
  agentNameHeading: css({
    margin: 0,
    lineHeight: 1.1,
  }),
  badgeRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
  }),
  heroMetaGrid: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(1.25),
    alignItems: 'flex-start',
    marginTop: theme.spacing(1.5),
  }),
  heroMetaChip: css({
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    gap: theme.spacing(0.25),
    borderRadius: theme.shape.radius.default,
    border: 'none',
    background: 'transparent',
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.2,
    minWidth: 0,
  }),
  heroMetaLabel: css({
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  heroMetaLabelWithHelp: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  heroMetaHelpIcon: css({
    display: 'inline-flex',
    color: theme.colors.text.secondary,
  }),
  heroMetaValue: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: theme.typography.h6.fontSize,
    lineHeight: 1.25,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  heroMetaValueMono: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    letterSpacing: '0.02em',
  }),
  heroMetaSubline: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.2,
  }),
  anonymousBanner: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.warning.border}`,
    background: theme.colors.warning.transparent,
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
  }),
  statsGrid: css({
    borderRadius: theme.shape.radius.default,
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(4),
    padding: theme.spacing(1.5, 1),
  }),
  primaryPanelsRow: css({
    display: 'grid',
    gap: theme.spacing(2),
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    alignItems: 'stretch',
  }),
  stretchPanel: css({
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  stretchPanelBody: css({
    flex: 1,
  }),
  promptPanelsRow: css({
    display: 'grid',
    gap: theme.spacing(2),
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    alignItems: 'start',
  }),
  panel: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    overflow: 'hidden',
  }),
  panelHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  panelBody: css({
    padding: theme.spacing(1.5),
  }),
  versionControls: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    [`@media (max-width: 640px)`]: {
      flexDirection: 'column' as const,
      alignItems: 'stretch',
    },
  }),
  versionSelect: css({
    flex: 1,
    minWidth: 0,
  }),
  recentVersionsGrid: css({
    display: 'flex',
    flexWrap: 'nowrap' as const,
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.75),
  }),
  recentVersionsHeading: css({
    marginTop: theme.spacing(1.25),
    marginBottom: theme.spacing(0.25),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  }),
  recentVersionItem: css({
    width: '100%',
    minWidth: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
  }),
  recentVersionBox: css({
    width: '100%',
    minWidth: 0,
    textAlign: 'left' as const,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(0.75, 1),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, background 0.15s ease',
    '&:hover': {
      borderColor: theme.colors.border.medium,
      background: theme.colors.action.hover,
    },
  }),
  recentVersionBoxActive: css({
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  recentVersionContent: css({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing(0.5),
    width: '100%',
    minWidth: 0,
  }),
  recentVersionText: css({
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
  }),
  recentVersionNumber: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.2,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  recentVersionRelativeTime: css({
    fontSize: theme.typography.size.sm,
    color: theme.colors.text.secondary,
    lineHeight: 1.2,
    whiteSpace: 'nowrap' as const,
    paddingLeft: theme.spacing(0.5),
  }),
  recentVersionScore: css({
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
    fontSize: theme.typography.size.sm,
    lineHeight: 1.2,
  }),
  versionTooltip: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
    minWidth: 180,
  }),
  versionTooltipTitle: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.25,
  }),
  versionTooltipMeta: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.25,
  }),
  versionTooltipStatus: css({
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.25,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  systemPrompt: css({
    margin: 0,
    maxHeight: 400,
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    lineHeight: 1.6,
    color: theme.colors.text.primary,
  }),
  modelChipsRow: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1),
  }),
  modelChipAnchor: css({
    position: 'relative' as const,
    display: 'inline-flex',
  }),
  modelChip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: '12px',
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    '&:hover': {
      borderColor: theme.colors.text.secondary,
      background: theme.colors.action.hover,
    },
  }),
  modelChipActive: css({
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  modelChipDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  }),
  ...getTokenizeControlStyles(theme),
});

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'n/a';
  }
  return parsed.toLocaleString();
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const withStatus = err as {
    status?: unknown;
    statusCode?: unknown;
    data?: { status?: unknown; statusCode?: unknown; message?: unknown };
    message?: unknown;
  };
  if (withStatus.status === 404 || withStatus.statusCode === 404) {
    return true;
  }
  if (withStatus.data?.status === 404 || withStatus.data?.statusCode === 404) {
    return true;
  }
  const message = typeof withStatus.message === 'string' ? withStatus.message : '';
  const dataMessage = typeof withStatus.data?.message === 'string' ? withStatus.data.message : '';
  return /\b404\b/.test(message) || /\b404\b/.test(dataMessage);
}

function buildAgentNameFromRoute(pathname: string, routeParam?: string): string {
  if (new RegExp(`(^|/)${ROUTES.Agents}/anonymous/?$`).test(pathname)) {
    return '';
  }
  return routeParam?.trim() ?? '';
}

function toTimestampMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function interpolateHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function extractSeries(response: PrometheusQueryResponse): number[] {
  if (response.status !== 'success' || response.data.resultType !== 'matrix') {
    return [];
  }
  const [series] = response.data.result as PrometheusMatrixResult[];
  if (!series?.values) {
    return [];
  }
  return series.values
    .map(([, value]) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function bucketValues(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  return Array.from({ length: targetCount }, (_, i) => {
    const start = Math.floor((i * values.length) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / targetCount));
    const slice = values.slice(start, end);
    const sum = slice.reduce((acc, value) => acc + value, 0);
    return sum / slice.length;
  });
}

function normalizeValuesToHeights(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  const bucketed = bucketValues(values, targetCount);
  const minValue = Math.min(...bucketed);
  const maxValue = Math.max(...bucketed);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return [];
  }
  if (Math.abs(maxValue - minValue) < 1e-9) {
    return bucketed.map(() => 60);
  }
  const minHeight = 20;
  const maxHeight = 100;
  return bucketed.map((value) => {
    const t = (value - minValue) / (maxValue - minValue);
    return minHeight + t * (maxHeight - minHeight);
  });
}

function scoreTone(theme: GrafanaTheme2, score: number): string {
  if (score >= 9) {
    return theme.colors.success.text;
  }
  if (score >= 7) {
    return theme.colors.info.text;
  }
  if (score >= 5) {
    return theme.colors.warning.text;
  }
  return theme.colors.error.text;
}

function formatRelativeDateCompact(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return 'n/a';
  }
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m`;
  }
  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h`;
  }
  return `${Math.floor(diffSec / 86400)}d`;
}

function firstLine(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return 'No summary available.';
  }
  const [line] = normalized
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return line ?? 'No summary available.';
}

function buildAgentStateContext(detail: AgentDetail): string {
  const modelLines = detail.models.length
    ? detail.models.map(
        (model, index) => `  ${index + 1}. ${model.provider}/${model.name} (${model.generation_count} generations)`
      )
    : ['  None recorded.'];
  const toolLines = detail.tools.length
    ? detail.tools.map((tool, index) => `  ${index + 1}. ${tool.name} (${tool.type}, ${tool.token_estimate} tokens)`)
    : ['  None recorded.'];
  return [
    '- Declared version (latest): ' + (detail.declared_version_latest || 'n/a'),
    '- Declared version (first): ' + (detail.declared_version_first || 'n/a'),
    '- First seen: ' + detail.first_seen_at,
    '- Last seen: ' + detail.last_seen_at,
    '- Generation count: ' + detail.generation_count,
    '- Token estimate: system=' +
      detail.token_estimate.system_prompt +
      ', tools=' +
      detail.token_estimate.tools_total +
      ', total=' +
      detail.token_estimate.total,
    '- Models:',
    ...modelLines,
    '- Tools:',
    ...toolLines,
    '',
    '## Current system prompt',
    detail.system_prompt || 'No system prompt recorded.',
  ].join('\n');
}

export default function AgentDetailPage({
  dataSource = defaultAgentsDataSource,
  modelCardClient = defaultModelCardClient,
  activityDataSource = defaultDashboardDataSource,
}: AgentDetailPageProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ agentName: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [versions, setVersions] = useState<AgentVersionListItem[]>([]);
  const [versionsCursor, setVersionsCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [initialRatingLoading, setInitialRatingLoading] = useState(false);
  const [initialRating, setInitialRating] = useState<AgentRatingResponse | null>(null);
  const [initialRatingError, setInitialRatingError] = useState('');
  const [recentVersionRatings, setRecentVersionRatings] = useState<Record<string, AgentRatingResponse | null>>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [modelCards, setModelCards] = useState<Map<string, ModelCard>>(new Map());
  const [openModel, setOpenModel] = useState<{ key: string; anchorRect: DOMRect } | null>(null);
  const [activityHeights, setActivityHeights] = useState<number[] | null>(null);
  const detailRequestVersion = useRef(0);
  const versionsRequestVersion = useRef(0);
  const ratingRequestVersion = useRef(0);
  const recentRatingsRequestVersion = useRef(0);

  const selectedVersion = searchParams.get('version')?.trim() ?? '';
  const agentName = buildAgentNameFromRoute(location.pathname, params.agentName);
  const isAnonymous = agentName.length === 0;
  const agentsTableRoute = `${PLUGIN_BASE}/${ROUTES.Agents}?tab=table`;

  useEffect(() => {
    detailRequestVersion.current += 1;
    const version = detailRequestVersion.current;

    queueMicrotask(() => {
      if (detailRequestVersion.current !== version) {
        return;
      }
      setLoading(true);
      setErrorMessage('');
    });

    dataSource
      .lookupAgent(agentName, selectedVersion.length > 0 ? selectedVersion : undefined)
      .then((item) => {
        if (detailRequestVersion.current !== version) {
          return;
        }
        setDetail(item);
      })
      .catch((err) => {
        if (detailRequestVersion.current !== version) {
          return;
        }
        setDetail(null);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load agent detail');
      })
      .finally(() => {
        if (detailRequestVersion.current !== version) {
          return;
        }
        setLoading(false);
      });
  }, [agentName, dataSource, selectedVersion]);

  useEffect(() => {
    ratingRequestVersion.current += 1;
    const version = ratingRequestVersion.current;

    queueMicrotask(() => {
      if (ratingRequestVersion.current !== version) {
        return;
      }
      setInitialRating(null);
      setInitialRatingLoading(true);
      setInitialRatingError('');
    });

    dataSource
      .lookupAgentRating(agentName, selectedVersion.length > 0 ? selectedVersion : undefined)
      .then((rating) => {
        if (ratingRequestVersion.current !== version) {
          return;
        }
        setInitialRating(rating);
      })
      .catch((err: unknown) => {
        if (ratingRequestVersion.current !== version) {
          return;
        }
        if (isNotFoundError(err)) {
          setInitialRating(null);
          setInitialRatingError('');
          return;
        }
        setInitialRating(null);
        setInitialRatingError(err instanceof Error ? err.message : 'Failed to load latest agent rating');
      })
      .finally(() => {
        if (ratingRequestVersion.current !== version) {
          return;
        }
        setInitialRatingLoading(false);
      });
  }, [agentName, dataSource, selectedVersion]);

  useEffect(() => {
    versionsRequestVersion.current += 1;
    const version = versionsRequestVersion.current;

    queueMicrotask(() => {
      if (versionsRequestVersion.current !== version) {
        return;
      }
      setLoadingVersions(true);
    });

    dataSource
      .listAgentVersions(agentName, VERSION_PAGE_SIZE)
      .then((response) => {
        if (versionsRequestVersion.current !== version) {
          return;
        }
        setVersions(response.items ?? []);
        setVersionsCursor(response.next_cursor ?? '');
      })
      .catch((err) => {
        if (versionsRequestVersion.current !== version) {
          return;
        }
        setVersions([]);
        setVersionsCursor('');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load versions');
      })
      .finally(() => {
        if (versionsRequestVersion.current !== version) {
          return;
        }
        setLoadingVersions(false);
      });
  }, [agentName, dataSource]);

  useEffect(() => {
    if (agentName.length === 0) {
      setActivityHeights(null);
      return;
    }
    let cancelled = false;
    const loadActivity = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const detailLastSeenSec = detail ? Math.floor(Date.parse(detail.last_seen_at) / 1000) : 0;
      const detailFirstSeenSec = detail ? Math.floor(Date.parse(detail.first_seen_at) / 1000) : 0;
      const to =
        Number.isFinite(detailLastSeenSec) && detailLastSeenSec > 0 ? Math.min(nowSec, detailLastSeenSec) : nowSec;
      const observedSpan =
        Number.isFinite(detailFirstSeenSec) && detailFirstSeenSec > 0 && detailFirstSeenSec < to
          ? to - detailFirstSeenSec
          : 0;
      const windowSec = Math.max(3600, Math.min(24 * 3600, observedSpan > 0 ? observedSpan : 3600));
      const from = to - windowSec;
      const step = computeStep(from, to);
      const interval = computeRateInterval(step);
      const query = requestsOverTimeQuery(
        { providers: [], models: [], agentNames: [agentName], labelFilters: [] },
        interval,
        'none'
      );
      try {
        const response = await activityDataSource.queryRange(query, from, to, step);
        if (cancelled) {
          return;
        }
        const values = extractSeries(response);
        setActivityHeights(normalizeValuesToHeights(values, ACTIVITY_BAR_COUNT));
      } catch {
        if (!cancelled) {
          setActivityHeights(null);
        }
      }
    };

    void loadActivity();
    const intervalId = setInterval(() => {
      void loadActivity();
    }, ACTIVITY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [agentName, activityDataSource, detail]);

  useEffect(() => {
    if (!detail || detail.models.length === 0) {
      setModelCards(new Map());
      return;
    }
    resolveModelCardsFromNames(
      detail.models.map((m) => ({ name: m.name, provider: m.provider })),
      modelCardClient
    )
      .then((cards) => setModelCards(cards))
      .catch(() => setModelCards(new Map()));
  }, [detail, modelCardClient]);

  const versionOptions = useMemo(() => {
    const deduped = new Map<string, AgentVersionListItem>();
    for (const item of versions) {
      deduped.set(item.effective_version, item);
    }
    if (detail && !deduped.has(detail.effective_version)) {
      deduped.set(detail.effective_version, {
        effective_version: detail.effective_version,
        declared_version_first: detail.declared_version_first,
        declared_version_latest: detail.declared_version_latest,
        first_seen_at: detail.first_seen_at,
        last_seen_at: detail.last_seen_at,
        generation_count: detail.generation_count,
        tool_count: detail.tool_count,
        system_prompt_prefix: detail.system_prompt_prefix,
        token_estimate: detail.token_estimate,
      });
    }
    return Array.from(deduped.values()).sort((a, b) => {
      const t1 = Date.parse(a.last_seen_at);
      const t2 = Date.parse(b.last_seen_at);
      return t2 - t1;
    });
  }, [detail, versions]);

  const versionSelectOptions = useMemo(() => {
    const options = versionOptions.map((v) => ({
      label: `${v.effective_version.replace(/^sha256:/, '').slice(0, 12)}…  ·  ${formatDateShort(v.last_seen_at)}  ·  ${v.generation_count.toLocaleString()} gen`,
      value: v.effective_version,
      description: v.declared_version_latest ? `Declared: ${v.declared_version_latest}` : undefined,
    }));
    if (versionsCursor.length > 0) {
      options.push({
        label: loadingVersions ? 'Loading more versions…' : 'Load more versions…',
        value: LOAD_MORE_VERSIONS_VALUE,
        description: 'Fetch older versions',
      });
    }
    return options;
  }, [loadingVersions, versionOptions, versionsCursor]);

  const recentVersions = useMemo(() => versionOptions.slice(0, 5).reverse(), [versionOptions]);

  useEffect(() => {
    setRecentVersionRatings({});
  }, [agentName]);

  useEffect(() => {
    if (agentName.length === 0 || recentVersions.length === 0) {
      return;
    }
    const unresolvedVersions = recentVersions
      .map((versionItem) => versionItem.effective_version)
      .filter((version) => recentVersionRatings[version] === undefined);
    if (unresolvedVersions.length === 0) {
      return;
    }

    recentRatingsRequestVersion.current += 1;
    const requestVersion = recentRatingsRequestVersion.current;

    Promise.all(
      unresolvedVersions.map(async (version) => {
        try {
          const rating = await dataSource.lookupAgentRating(agentName, version);
          return { version, rating };
        } catch (err: unknown) {
          if (isNotFoundError(err)) {
            return { version, rating: null };
          }
          throw err;
        }
      })
    )
      .then((results) => {
        if (recentRatingsRequestVersion.current !== requestVersion) {
          return;
        }
        setRecentVersionRatings((prev) => {
          const next = { ...prev };
          for (const result of results) {
            next[result.version] = result.rating;
          }
          return next;
        });
      })
      .catch((err: unknown) => {
        if (recentRatingsRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load version ratings');
      });
  }, [agentName, dataSource, recentVersionRatings, recentVersions]);

  const selectVersion = (nextVersion: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextVersion.trim().length === 0) {
      next.delete('version');
    } else {
      next.set('version', nextVersion);
    }
    setSearchParams(next, { replace: false });
  };

  const loadMoreVersions = async () => {
    if (loadingVersions || versionsCursor.length === 0) {
      return;
    }
    setLoadingVersions(true);
    try {
      const response = await dataSource.listAgentVersions(agentName, VERSION_PAGE_SIZE, versionsCursor);
      setVersions((prev) => [...prev, ...(response.items ?? [])]);
      setVersionsCursor(response.next_cursor ?? '');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load more versions');
    } finally {
      setLoadingVersions(false);
    }
  };

  const autoEncoding = useMemo(() => {
    if (!detail) {
      return 'cl100k_base' as EncodingName;
    }
    const firstModel = detail.models[0];
    return getEncoding(firstModel?.provider, firstModel?.name);
  }, [detail]);

  const versionKey = `${agentName}:${selectedVersion}`;
  const [tokenizeState, setTokenizeState] = useState<{
    versionKey: string;
    sections: Record<string, boolean>;
    encodingOverride: EncodingName | null;
  }>({ versionKey, sections: {}, encodingOverride: null });

  const tokenizedSections = tokenizeState.versionKey === versionKey ? tokenizeState.sections : {};
  const encodingOverride = tokenizeState.versionKey === versionKey ? tokenizeState.encodingOverride : null;

  const activeEncoding = encodingOverride ?? autoEncoding;
  const anyTokenized = Object.values(tokenizedSections).some(Boolean);
  const { encode, decode, isLoading: tokenizerLoading } = useTokenizer(anyTokenized ? activeEncoding : null);

  const setEncodingOverride = useCallback(
    (enc: EncodingName | null) => {
      setTokenizeState((prev) => ({
        versionKey,
        sections: prev.versionKey === versionKey ? prev.sections : {},
        encodingOverride: enc,
      }));
    },
    [versionKey]
  );

  const toggleSection = useCallback(
    (key: string) => {
      setTokenizeState((prev) => {
        const sections = prev.versionKey === versionKey ? prev.sections : {};
        return {
          versionKey,
          sections: { ...sections, [key]: !sections[key] },
          encodingOverride: prev.versionKey === versionKey ? prev.encodingOverride : null,
        };
      });
    },
    [versionKey]
  );

  const agentStateContext = useMemo(() => (detail ? buildAgentStateContext(detail) : ''), [detail]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={styles.page}>
        <Alert severity="error" title="Agent not found">
          <Text>The selected agent detail could not be loaded.</Text>
        </Alert>
        <Button variant="secondary" icon="arrow-left" onClick={() => navigate(agentsTableRoute)}>
          Back to agents
        </Button>
      </div>
    );
  }

  const activeVersion = selectedVersion.length > 0 ? selectedVersion : detail.effective_version;
  const primaryModel = detail.models[0];
  const primaryModelLabel =
    primaryModel != null ? stripProviderPrefix(primaryModel.name, getProviderMeta(primaryModel.provider).label) : 'n/a';
  const primaryModelProvider = primaryModel != null ? getProviderMeta(primaryModel.provider).label : null;
  const gradientColors = ['#5794F2', '#B877D9', '#FF9830'] as const;
  const displayActivityHeights = activityHeights && activityHeights.length > 0 ? activityHeights : EMPTY_ACTIVITY_BARS;
  const latestHeroRating = selectedVersion.length === 0 && initialRating?.status === 'completed' ? initialRating : null;
  const latestHeroRatingTooltip = latestHeroRating ? firstLine(latestHeroRating.summary) : '';

  return (
    <div className={styles.page}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.heroStack}>
        <div className={styles.heroActivityTop}>
          <div className={styles.heroActivityBars} aria-hidden>
            {displayActivityHeights.map((height, i) => {
              const t = i / (ACTIVITY_BAR_COUNT - 1);
              const color =
                t <= 0.52
                  ? interpolateHex(gradientColors[0], gradientColors[1], t / 0.52)
                  : interpolateHex(gradientColors[1], gradientColors[2], (t - 0.52) / 0.48);
              return (
                <div key={i} className={styles.heroActivityBarSlot}>
                  <div
                    className={styles.heroActivityBar}
                    style={{
                      transform: `scaleY(${height / 100})`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.heroPanel}>
          {latestHeroRating && (
            <div className={styles.heroTopRightRating}>
              <Tooltip content={latestHeroRatingTooltip} placement="left">
                <span aria-label={`Latest rating summary: ${latestHeroRatingTooltip}`}>
                  <Badge
                    text={`Latest ${latestHeroRating.score}/10`}
                    color={
                      latestHeroRating.score >= 9
                        ? 'green'
                        : latestHeroRating.score >= 7
                          ? 'blue'
                          : latestHeroRating.score >= 5
                            ? 'orange'
                            : 'red'
                    }
                  />
                </span>
              </Tooltip>
            </div>
          )}
          <div className={styles.heroPanelBody}>
            <div className={styles.heroGlow} aria-hidden />
            <div className={styles.heroTitleMeta}>
              <div className={styles.heroTitleRow}>
                <Button
                  variant="secondary"
                  fill="text"
                  size="sm"
                  icon="arrow-left"
                  className={styles.heroBackButton}
                  onClick={() => navigate(agentsTableRoute)}
                >
                  All agents
                </Button>
                <div>
                  <div className={styles.heroEyebrow}>Agent</div>
                  <h2 className={styles.agentNameHeading}>
                    {isAnonymous ? 'Unnamed agent bucket' : detail.agent_name}
                  </h2>
                </div>
                <div className={styles.badgeRow}>{isAnonymous && <Badge text="Anonymous" color="orange" />}</div>
              </div>
              <div className={styles.heroMetaGrid}>
                <div className={styles.heroMetaChip}>
                  <span className={styles.heroMetaLabelWithHelp}>
                    <span className={styles.heroMetaLabel}>Versions</span>
                    <Tooltip content="Total distinct effective versions recorded for this agent." placement="top">
                      <span aria-label="Versions help">
                        <Icon name="info-circle" size="sm" className={styles.heroMetaHelpIcon} />
                      </span>
                    </Tooltip>
                  </span>
                  <span className={styles.heroMetaValue}>{versionOptions.length.toLocaleString()}</span>
                </div>
                <div className={styles.heroMetaChip}>
                  <span className={styles.heroMetaLabelWithHelp}>
                    <span className={styles.heroMetaLabel}>Declared version</span>
                    <Tooltip content="Version string reported by instrumentation." placement="top">
                      <span aria-label="Declared version help">
                        <Icon name="info-circle" size="sm" className={styles.heroMetaHelpIcon} />
                      </span>
                    </Tooltip>
                  </span>
                  <span className={styles.heroMetaValue}>{detail.declared_version_latest || 'n/a'}</span>
                </div>
                <div className={styles.heroMetaChip}>
                  <span className={styles.heroMetaLabelWithHelp}>
                    <span className={styles.heroMetaLabel}>Models</span>
                    <Tooltip content="Distinct model variants recorded for this agent version." placement="top">
                      <span aria-label="Models help">
                        <Icon name="info-circle" size="sm" className={styles.heroMetaHelpIcon} />
                      </span>
                    </Tooltip>
                  </span>
                  <span className={styles.heroMetaValue}>{detail.models.length.toLocaleString()}</span>
                </div>
                <div className={styles.heroMetaChip}>
                  <span className={styles.heroMetaLabelWithHelp}>
                    <span className={styles.heroMetaLabel}>Tools</span>
                    <Tooltip content="Declared tool definitions." placement="top">
                      <span aria-label="Tools help">
                        <Icon name="info-circle" size="sm" className={styles.heroMetaHelpIcon} />
                      </span>
                    </Tooltip>
                  </span>
                  <span className={styles.heroMetaValue}>{detail.tool_count.toLocaleString()}</span>
                </div>
                <div className={styles.heroMetaChip}>
                  <span className={styles.heroMetaLabelWithHelp}>
                    <span className={styles.heroMetaLabel}>Primary model</span>
                    <Tooltip content="Primary model name and provider in this version." placement="top">
                      <span aria-label="Primary model help">
                        <Icon name="info-circle" size="sm" className={styles.heroMetaHelpIcon} />
                      </span>
                    </Tooltip>
                  </span>
                  <span className={styles.heroMetaValue}>{primaryModelLabel}</span>
                  <span className={styles.heroMetaSubline}>{primaryModelProvider ?? 'No model data'}</span>
                </div>
              </div>
              {detail.models.length > 0 && (
                <div className={styles.modelChipsRow}>
                  {detail.models.map((model) => {
                    const cardKey = `${model.provider}::${model.name}`;
                    const card = modelCards.get(cardKey) ?? null;
                    const meta = getProviderMeta(model.provider);
                    const chipLabel = card
                      ? stripProviderPrefix(card.name || card.source_model_id, meta.label)
                      : stripProviderPrefix(model.name, meta.label);
                    const dotColor = getProviderColor(model.provider);
                    const isOpen = openModel?.key === cardKey;
                    return (
                      <div key={cardKey} className={styles.modelChipAnchor}>
                        <button
                          type="button"
                          className={`${styles.modelChip} ${isOpen ? styles.modelChipActive : ''}`}
                          onClick={(event) => {
                            if (isOpen) {
                              setOpenModel(null);
                              return;
                            }
                            setOpenModel({ key: cardKey, anchorRect: event.currentTarget.getBoundingClientRect() });
                          }}
                          aria-label={`model card ${chipLabel}`}
                        >
                          <span className={styles.modelChipDot} style={{ background: dotColor }} />
                          <span>{chipLabel}</span>
                        </button>
                        {isOpen && card && (
                          <ModelCardPopover
                            card={card}
                            anchorRect={openModel?.anchorRect ?? null}
                            onClose={() => setOpenModel(null)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isAnonymous && (
        <div className={styles.anonymousBanner}>
          <Text variant="bodySmall" color="secondary">
            This bucket aggregates generations where <code>gen_ai.agent.name</code> was missing. Treat versions here as
            diagnostic clusters.
          </Text>
        </div>
      )}

      <div className={styles.statsGrid}>
        <Tooltip content="Total generations recorded for this agent version." placement="top">
          <div>
            <TopStat label="Generations" value={detail.generation_count} loading={false} />
          </div>
        </Tooltip>
        <Tooltip content="The earliest time a generation was recorded for this agent version." placement="top">
          <div>
            <TopStat
              label="First seen"
              value={toTimestampMs(detail.first_seen_at)}
              displayValue={formatDate(detail.first_seen_at)}
              loading={false}
            />
          </div>
        </Tooltip>
        <Tooltip content="The most recent time any generation was recorded for this agent version." placement="top">
          <div>
            <TopStat
              label="Last seen"
              value={toTimestampMs(detail.last_seen_at)}
              displayValue={formatDate(detail.last_seen_at)}
              loading={false}
            />
          </div>
        </Tooltip>
        <Tooltip content="Estimated tokens consumed by the system prompt in this version." placement="top">
          <div>
            <TopStat label="Prompt tokens" value={detail.token_estimate.system_prompt} loading={false} />
          </div>
        </Tooltip>
        <Tooltip content="Estimated tokens consumed by all tool schemas combined in this version." placement="top">
          <div>
            <TopStat label="Tools tokens" value={detail.token_estimate.tools_total} loading={false} />
          </div>
        </Tooltip>
        <Tooltip
          content="Sum of system prompt and tool tokens — the baseline context cost per generation."
          placement="top"
        >
          <div>
            <TopStat label="Total tokens" value={detail.token_estimate.total} loading={false} />
          </div>
        </Tooltip>
      </div>

      <div className={styles.primaryPanelsRow}>
        <div className={cx(styles.panel, styles.stretchPanel)}>
          <div className={styles.panelHeader}>
            <Text weight="medium">Versions</Text>
          </div>
          <div className={cx(styles.panelBody, styles.stretchPanelBody)}>
            <div className={styles.versionControls}>
              <div className={styles.versionSelect}>
                <Select
                  options={versionSelectOptions}
                  value={activeVersion}
                  onChange={(selected) => {
                    if (selected?.value === LOAD_MORE_VERSIONS_VALUE) {
                      void loadMoreVersions();
                      return;
                    }
                    selectVersion(selected?.value ?? '');
                  }}
                  isLoading={loadingVersions}
                  placeholder="Select a version…"
                  aria-label="agent version selector"
                />
              </div>
              <Button variant="secondary" onClick={() => selectVersion('')} disabled={selectedVersion.length === 0}>
                Latest
              </Button>
            </div>
            {recentVersions.length > 0 && (
              <>
                <div className={styles.recentVersionsHeading}>Recent versions</div>
                <div className={styles.recentVersionsGrid}>
                  {recentVersions.map((versionItem, index) => {
                    const rating = recentVersionRatings[versionItem.effective_version];
                    const isSelected = activeVersion === versionItem.effective_version;
                    const completedRating = rating?.status === 'completed' ? rating : null;
                    const versionNumber =
                      versionItem.declared_version_latest || versionItem.declared_version_first || `#${index + 1}`;
                    const tooltipContent = (
                      <div className={styles.versionTooltip}>
                        <div className={styles.versionTooltipTitle}>Version {versionNumber}</div>
                        <div className={styles.versionTooltipMeta}>
                          Last seen {formatDate(versionItem.last_seen_at)}
                        </div>
                        <div
                          className={styles.versionTooltipStatus}
                          style={{
                            color: completedRating
                              ? scoreTone(theme, completedRating.score)
                              : theme.colors.text.secondary,
                          }}
                        >
                          {completedRating ? `Rated ${completedRating.score}/10` : 'Unrated'}
                        </div>
                      </div>
                    );
                    return (
                      <div key={versionItem.effective_version} className={styles.recentVersionItem}>
                        <Tooltip content={tooltipContent} placement="top">
                          <button
                            type="button"
                            className={cx(styles.recentVersionBox, isSelected && styles.recentVersionBoxActive)}
                            onClick={() => selectVersion(versionItem.effective_version)}
                            aria-label={`select version ${versionItem.effective_version}`}
                          >
                            <span className={styles.recentVersionContent}>
                              <span className={styles.recentVersionText}>
                                <span className={styles.recentVersionNumber}>{versionNumber}</span>
                              </span>
                              {completedRating && (
                                <span
                                  className={styles.recentVersionScore}
                                  style={{ color: scoreTone(theme, completedRating.score) }}
                                >
                                  {completedRating.score}/10
                                </span>
                              )}
                            </span>
                          </button>
                        </Tooltip>
                        <span className={styles.recentVersionRelativeTime}>
                          {formatRelativeDateCompact(versionItem.last_seen_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <ToolsPanel
          tools={detail.tools}
          tokenized={tokenizedSections['tools']}
          onToggleTokenize={() => toggleSection('tools')}
          tokenizerLoading={tokenizerLoading}
          autoEncoding={autoEncoding}
          encodingOverride={encodingOverride}
          onEncodingChange={setEncodingOverride}
          encode={encode}
          decode={decode}
        />
      </div>

      <div className={styles.promptPanelsRow}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <Text weight="medium">System prompt</Text>
            <span style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
              <span
                className={cx(styles.tokenizeBtn, tokenizedSections['system'] && styles.tokenizeBtnActive)}
                onClick={() => toggleSection('system')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    toggleSection('system');
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <Icon name="brackets-curly" size="xs" />
                {tokenizerLoading ? 'Loading\u2026' : 'Tokenize'}
              </span>
              {tokenizedSections['system'] && (
                <select
                  className={styles.encodingSelect}
                  aria-label="Tokenizer encoding"
                  value={encodingOverride ?? ''}
                  onChange={(e) => setEncodingOverride(e.target.value ? (e.target.value as EncodingName) : null)}
                >
                  <option value="">Auto ({autoEncoding.replace('_base', '')})</option>
                  {AVAILABLE_ENCODINGS.map((enc) => (
                    <option key={enc.value} value={enc.value}>
                      {enc.value.replace('_base', '')}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </div>
          <div className={styles.panelBody}>
            {detail.system_prompt.length > 0 ? (
              tokenizedSections['system'] && encode && decode ? (
                <div className={styles.systemPrompt}>
                  <TokenizedText text={detail.system_prompt} encode={encode} decode={decode} />
                </div>
              ) : (
                <pre className={styles.systemPrompt}>{detail.system_prompt}</pre>
              )
            ) : (
              <pre className={styles.systemPrompt}>No system prompt recorded.</pre>
            )}
          </div>
        </div>

        <AgentRatingPanel
          agentName={agentName}
          version={activeVersion}
          agentStateContext={agentStateContext}
          dataSource={dataSource}
          initialResult={initialRating}
          initialLoading={initialRatingLoading || initialRating?.status === 'pending'}
          initialError={initialRatingError}
        />
      </div>
    </div>
  );
}
