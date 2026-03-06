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
import { isNotFoundError } from '../utils/http';
import { defaultDashboardDataSource, type DashboardDataSource } from '../dashboard/api';
import { computeRateInterval, computeStep, requestsOverTimeQuery } from '../dashboard/queries';
import type { PrometheusMatrixResult, PrometheusQueryResponse } from '../dashboard/types';
import { TokenizedText } from '../components/tokenizer/TokenizedText';
import { useTokenizer } from '../components/tokenizer/useTokenizer';
import { getEncoding, AVAILABLE_ENCODINGS, type EncodingName } from '../components/tokenizer/encodingMap';
import { getTokenizeControlStyles } from '../components/tokenizer/tokenizeControls.styles';
import { TopStat } from '../components/TopStat';
import MarkdownPreview from '../components/markdown/MarkdownPreview';

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
    padding: theme.spacing(2.5, 2, 2.5, 2),
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  }),
  heroTitleRow: css({
    display: 'grid',
    gridTemplateColumns: 'auto minmax(220px, 1fr) minmax(540px, 2fr)',
    alignItems: 'start',
    gap: theme.spacing(2),
    '@media (max-width: 1200px)': {
      gridTemplateColumns: 'auto minmax(220px, 1fr)',
    },
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
  }),
  heroTitleMeta: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  heroAgentBlock: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
    alignItems: 'flex-start',
    minWidth: 0,
  }),
  heroStatsColumn: css({
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
    marginTop: theme.spacing(0.5),
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
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
  }),
  heroMetaGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: theme.spacing(0.75, 1),
    width: '100%',
    '@media (max-width: 1400px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    },
    '@media (max-width: 900px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  }),
  heroMetaStat: css({
    minWidth: 0,
    paddingTop: theme.spacing(0.5),
  }),
  heroMetaStatWide: css({
    gridColumn: 'span 2',
    '@media (max-width: 900px)': {
      gridColumn: 'auto',
    },
  }),
  heroMetaStatHighlight: css({
    minWidth: 0,
    padding: theme.spacing(1, 1.25),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  latestScoreBlocks: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(10, minmax(0, 1fr))',
    gap: 3,
    marginTop: theme.spacing(0.5),
  }),
  latestScoreBlock: css({
    height: 6,
    borderRadius: 2,
    background: theme.colors.border.weak,
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
    justifyContent: 'center',
    alignContent: 'center',
    alignItems: 'center',
    gap: theme.spacing(4),
    height: '100%',
    padding: theme.spacing(1.5),
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
    alignItems: 'stretch',
  }),
  combinedPromptSections: css({
    display: 'grid',
    gap: theme.spacing(2),
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    alignItems: 'stretch',
  }),
  sectionBlock: css({
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
  }),
  sectionTitle: css({
    marginBottom: theme.spacing(1),
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
  panelHeaderControls: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginLeft: 'auto',
    flexWrap: 'wrap' as const,
  }),
  promptViewToggle: css({
    display: 'inline-flex',
    alignItems: 'center',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  promptViewToggleButton: css({
    border: 'none',
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    padding: `${theme.spacing(0.375)} ${theme.spacing(1)}`,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.2,
    '&:hover': {
      color: theme.colors.text.primary,
      background: theme.colors.action.hover,
    },
  }),
  promptViewToggleButtonActive: css({
    background: theme.colors.background.canvas,
    color: theme.colors.text.primary,
  }),
  panelBody: css({
    padding: theme.spacing(1.5),
  }),
  plainPanel: css({
    border: 'none',
    background: 'transparent',
    borderRadius: 0,
    overflow: 'visible',
  }),
  plainPanelHeader: css({
    borderBottom: 'none',
    padding: `${theme.spacing(0.25)} 0 ${theme.spacing(0.5)}`,
  }),
  statsHeaderLabel: css({
    display: 'block',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    fontWeight: theme.typography.fontWeightMedium,
    marginBottom: theme.spacing(0.5),
  }),
  plainPanelBody: css({
    padding: theme.spacing(1.25),
  }),
  versionsPanelBody: css({
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
  }),
  versionControls: css({
    display: 'flex',
    gap: theme.spacing(0.75),
    alignItems: 'center',
    [`@media (max-width: 640px)`]: {
      flexDirection: 'column' as const,
      alignItems: 'stretch',
    },
  }),
  versionSelect: css({
    flex: 1,
    minWidth: 0,
    '& [class*="singleValue"], & [class*="placeholder"], & [class*="option"], & input': {
      fontSize: theme.typography.bodySmall.fontSize,
    },
  }),
  recentVersionsGrid: css({
    display: 'flex',
    flexWrap: 'nowrap' as const,
    gap: 0,
    marginTop: theme.spacing(0.5),
    overflowX: 'auto' as const,
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
    gap: theme.spacing(0.125),
  }),
  recentVersionItemActive: css({}),
  recentVersionBox: css({
    width: '100%',
    minWidth: 0,
    textAlign: 'left' as const,
    appearance: 'none' as const,
    outline: 'none',
    borderRadius: theme.shape.radius.default,
    border: 'none',
    background: theme.colors.background.canvas,
    padding: theme.spacing(0.5, 0.75),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  recentVersionBoxActive: css({
    background: theme.colors.primary.transparent,
    boxShadow: `inset 0 0 0 1px ${theme.colors.primary.border}, 0 0 0 1px ${theme.colors.primary.transparent}`,
  }),
  recentVersionContent: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    width: '100%',
    minWidth: 0,
  }),
  recentVersionContentSingle: css({
    gridTemplateColumns: '1fr',
  }),
  recentVersionText: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    minWidth: 0,
  }),
  recentVersionTextCentered: css({
    alignItems: 'center',
  }),
  recentVersionNumber: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.2,
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  recentVersionNumberCentered: css({
    textAlign: 'center' as const,
  }),
  recentVersionNumberActive: css({
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightBold,
  }),
  recentVersionRelativeTime: css({
    fontSize: theme.typography.size.sm,
    color: theme.colors.text.secondary,
    lineHeight: 1.2,
    whiteSpace: 'nowrap' as const,
    textAlign: 'center' as const,
    width: '100%',
  }),
  recentVersionRelativeTimeActive: css({
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  recentVersionTimelineMarker: css({
    position: 'relative' as const,
    height: 14,
    width: `calc(100% + ${theme.spacing(1.5)})`,
    marginLeft: `-${theme.spacing(0.75)}`,
    '&::before': {
      content: '""',
      position: 'absolute' as const,
      top: '50%',
      left: 0,
      right: 0,
      borderTop: `2px solid ${theme.colors.border.medium}`,
      transform: 'translateY(-50%)',
      opacity: 0.95,
    },
    '&::after': {
      content: '""',
      position: 'absolute' as const,
      top: '50%',
      left: '50%',
      width: 10,
      height: 10,
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)',
      background: theme.colors.background.canvas,
      border: `2px solid ${theme.colors.border.strong}`,
      boxShadow: `0 0 0 1px ${theme.colors.background.primary}`,
      zIndex: 1,
    },
  }),
  recentVersionTimelineMarkerStart: css({
    '&::before': {
      left: '50%',
    },
  }),
  recentVersionTimelineMarkerEnd: css({
    '&::before': {
      right: '50%',
    },
  }),
  recentVersionTimelineMarkerActive: css({
    '&::after': {
      borderColor: theme.colors.primary.border,
      background: theme.colors.primary.main,
      boxShadow: `0 0 0 2px ${theme.colors.primary.transparent}`,
    },
  }),
  recentVersionScore: css({
    justifySelf: 'start',
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
    fontSize: theme.typography.size.sm,
    lineHeight: 1.2,
  }),
  recentVersionScoreActive: css({
    fontWeight: theme.typography.fontWeightBold,
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
    minHeight: 280,
    maxHeight: 580,
    height: '100%',
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
  systemPromptPreview: css({
    margin: 0,
    minHeight: 280,
    maxHeight: 580,
    height: '100%',
    overflow: 'auto',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: theme.spacing(1.5),
    color: theme.colors.text.primary,
  }),
  systemPromptContent: css({
    flex: 1,
    minHeight: 0,
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

function formatDurationCompact(fromIso: string, toIso: string): string {
  const fromTs = Date.parse(fromIso);
  const toTs = Date.parse(toIso);
  if (Number.isNaN(fromTs) || Number.isNaN(toTs)) {
    return 'n/a';
  }
  const diffSec = Math.max(0, Math.floor((toTs - fromTs) / 1000));
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
  const recentVersionRatingsRef = useRef<Record<string, AgentRatingResponse | null>>({});
  const promptAnalysisSectionRef = useRef<HTMLDivElement | null>(null);

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
    recentVersionRatingsRef.current = {};
    setRecentVersionRatings({});
  }, [agentName]);

  useEffect(() => {
    if (agentName.length === 0 || recentVersions.length === 0) {
      return;
    }
    const unresolvedVersions = recentVersions
      .map((versionItem) => versionItem.effective_version)
      .filter((version) => !(version in recentVersionRatingsRef.current));
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
          recentVersionRatingsRef.current = next;
          return next;
        });
      })
      .catch((err: unknown) => {
        if (recentRatingsRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load version ratings');
      });
  }, [agentName, dataSource, recentVersions]);

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
  const [systemPromptView, setSystemPromptView] = useState<'preview' | 'markdown'>('markdown');

  const tokenizedSections = tokenizeState.versionKey === versionKey ? tokenizeState.sections : {};
  const encodingOverride = tokenizeState.versionKey === versionKey ? tokenizeState.encodingOverride : null;
  const isSystemTokenized = Boolean(tokenizedSections['system']);

  const activeEncoding = encodingOverride ?? autoEncoding;
  const anyTokenized = Object.values(tokenizedSections).some(Boolean);
  const { encode, decode, isLoading: tokenizerLoading } = useTokenizer(anyTokenized ? activeEncoding : null);

  useEffect(() => {
    if (isSystemTokenized && systemPromptView !== 'markdown') {
      setSystemPromptView('markdown');
    }
  }, [isSystemTokenized, systemPromptView]);

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
  const scrollToPromptAnalysis = useCallback(() => {
    promptAnalysisSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const handleRatingResultChange = useCallback((nextRating: AgentRatingResponse | null) => {
    if (nextRating === null) {
      return;
    }
    setInitialRating(nextRating);
    setInitialRatingError('');
    setInitialRatingLoading(false);
  }, []);

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
  const activeHeroRating = initialRating?.status === 'completed' ? initialRating : null;
  const activeHeroRatingSummary = activeHeroRating ? firstLine(activeHeroRating.summary) : '';
  const activeScoreFilledBlocks = activeHeroRating ? Math.max(0, Math.min(10, Math.round(activeHeroRating.score))) : 0;

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
          <div className={styles.heroPanelBody}>
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
                <div className={styles.heroAgentBlock}>
                  <div className={styles.heroEyebrow}>Agent</div>
                  <h2 className={styles.agentNameHeading}>
                    {isAnonymous ? 'Unnamed agent bucket' : detail.agent_name}
                  </h2>
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
                  <div className={styles.badgeRow}>{isAnonymous && <Badge text="Anonymous" color="orange" />}</div>
                </div>
                <div className={styles.heroStatsColumn}>
                  <div className={styles.heroMetaGrid}>
                    <div className={styles.heroMetaStat}>
                      <TopStat
                        label="VERSIONS"
                        value={versionOptions.length}
                        loading={false}
                        compact
                        normalFontSize
                        helpTooltip="Total distinct effective versions recorded for this agent."
                      />
                    </div>
                    <div className={styles.heroMetaStat}>
                      <TopStat
                        label="DECLARED VERSION"
                        value={0}
                        displayValue={detail.declared_version_latest || 'n/a'}
                        loading={false}
                        compact
                        normalFontSize
                        helpTooltip="Version string reported by instrumentation."
                      />
                    </div>
                    <div className={styles.heroMetaStat}>
                      <TopStat
                        label="MODELS"
                        value={detail.models.length}
                        loading={false}
                        compact
                        normalFontSize
                        helpTooltip="Distinct model variants recorded for this agent version."
                      />
                    </div>
                    <div className={styles.heroMetaStat}>
                      <TopStat
                        label="TOOLS"
                        value={detail.tool_count}
                        loading={false}
                        compact
                        normalFontSize
                        helpTooltip="Declared tool definitions."
                      />
                    </div>
                    <div className={cx(styles.heroMetaStat, styles.heroMetaStatWide)}>
                      <TopStat
                        label="PRIMARY MODEL"
                        value={0}
                        displayValue={
                          primaryModelProvider ? `${primaryModelLabel} (${primaryModelProvider})` : primaryModelLabel
                        }
                        loading={false}
                        compact
                        normalFontSize
                        helpTooltip="Primary model name and provider in this version."
                      />
                    </div>
                    <div className={styles.heroMetaStatHighlight}>
                      <TopStat
                        label="LATEST SCORE"
                        value={0}
                        displayValue={activeHeroRating ? `${activeHeroRating.score}/10` : 'n/a'}
                        loading={false}
                        compact
                        normalFontSize
                        helpTooltip={
                          activeHeroRating
                            ? `Completed rating summary for selected version: ${activeHeroRatingSummary}`
                            : 'No completed rating available for selected version.'
                        }
                      />
                      <div className={styles.latestScoreBlocks} aria-hidden="true">
                        {Array.from({ length: 10 }, (_, idx) => (
                          <span
                            key={idx}
                            className={styles.latestScoreBlock}
                            style={
                              idx < activeScoreFilledBlocks
                                ? {
                                    backgroundColor:
                                      idx / 9 <= 0.52
                                        ? interpolateHex(gradientColors[0], gradientColors[1], idx / 9 / 0.52)
                                        : interpolateHex(gradientColors[1], gradientColors[2], (idx / 9 - 0.52) / 0.48),
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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

      <div className={styles.primaryPanelsRow}>
        <div className={cx(styles.panel, styles.plainPanel, styles.stretchPanel)}>
          <div
            className={cx(styles.panelBody, styles.plainPanelBody, styles.versionsPanelBody, styles.stretchPanelBody)}
          >
            <span className={styles.statsHeaderLabel}>Versions</span>
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
                      <div
                        key={versionItem.effective_version}
                        className={cx(styles.recentVersionItem, isSelected && styles.recentVersionItemActive)}
                      >
                        <Tooltip content={tooltipContent} placement="top">
                          <button
                            type="button"
                            className={cx(styles.recentVersionBox, isSelected && styles.recentVersionBoxActive)}
                            onClick={() => selectVersion(versionItem.effective_version)}
                            aria-label={`select version ${versionItem.effective_version}`}
                          >
                            <span
                              className={cx(
                                styles.recentVersionContent,
                                !completedRating && styles.recentVersionContentSingle
                              )}
                            >
                              <span
                                className={cx(
                                  styles.recentVersionText,
                                  !completedRating && styles.recentVersionTextCentered
                                )}
                              >
                                <span
                                  className={cx(
                                    styles.recentVersionNumber,
                                    !completedRating && styles.recentVersionNumberCentered,
                                    isSelected && styles.recentVersionNumberActive
                                  )}
                                >
                                  {versionNumber}
                                </span>
                              </span>
                              {completedRating && (
                                <span
                                  className={cx(
                                    styles.recentVersionScore,
                                    isSelected && styles.recentVersionScoreActive
                                  )}
                                  style={{ color: scoreTone(theme, completedRating.score) }}
                                >
                                  {completedRating.score}/10
                                </span>
                              )}
                            </span>
                            <span
                              className={cx(
                                styles.recentVersionTimelineMarker,
                                index === 0 && styles.recentVersionTimelineMarkerStart,
                                index === recentVersions.length - 1 && styles.recentVersionTimelineMarkerEnd,
                                isSelected && styles.recentVersionTimelineMarkerActive
                              )}
                              aria-hidden="true"
                            />
                            <span
                              className={cx(
                                styles.recentVersionRelativeTime,
                                isSelected && styles.recentVersionRelativeTimeActive
                              )}
                            >
                              {formatRelativeDateCompact(versionItem.last_seen_at)}
                            </span>
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={cx(styles.stretchPanel, styles.stretchPanelBody)}>
          <div className={styles.statsGrid}>
            <TopStat
              label="GENERATIONS"
              value={detail.generation_count}
              loading={false}
              helpTooltip="Total generations recorded for this agent version."
            />
            <TopStat
              label="PROMPT TOKENS"
              value={detail.token_estimate.system_prompt}
              loading={false}
              helpTooltip="Estimated tokens consumed by the system prompt in this version."
            />
            <TopStat
              label="TOOLS TOKENS"
              value={detail.token_estimate.tools_total}
              loading={false}
              helpTooltip="Estimated tokens consumed by all tool schemas combined in this version."
            />
            <TopStat
              label="TOTAL TOKENS"
              value={detail.token_estimate.total}
              loading={false}
              helpTooltip="Sum of system prompt and tool tokens - the baseline context cost per generation."
            />
            <TopStat
              label="AGE"
              value={Math.max(0, toTimestampMs(detail.last_seen_at) - toTimestampMs(detail.first_seen_at))}
              displayValue={formatDurationCompact(detail.first_seen_at, detail.last_seen_at)}
              loading={false}
              helpTooltip="Duration between first and last recorded generations for this version."
            />
            <TopStat
              label="FIRST SEEN"
              value={toTimestampMs(detail.first_seen_at)}
              displayValue={formatDate(detail.first_seen_at)}
              loading={false}
              helpTooltip="The earliest time a generation was recorded for this agent version."
            />
            <TopStat
              label="LAST SEEN"
              value={toTimestampMs(detail.last_seen_at)}
              displayValue={formatDate(detail.last_seen_at)}
              loading={false}
              helpTooltip="The most recent time any generation was recorded for this agent version."
            />
          </div>
        </div>
      </div>

      <div ref={promptAnalysisSectionRef} className={cx(styles.panel, styles.stretchPanel)}>
        <div className={styles.panelHeader}>
          <Text weight="medium">System prompt and context analysis</Text>
        </div>
        <div className={cx(styles.panelBody, styles.stretchPanelBody)}>
          <div className={styles.combinedPromptSections}>
            <div className={styles.sectionBlock}>
              <span className={styles.panelHeaderControls}>
                <span className={styles.promptViewToggle} aria-label="System prompt view toggle">
                  <button
                    type="button"
                    className={cx(
                      styles.promptViewToggleButton,
                      systemPromptView === 'preview' && styles.promptViewToggleButtonActive
                    )}
                    aria-pressed={systemPromptView === 'preview'}
                    onClick={() => {
                      if (!isSystemTokenized) {
                        setSystemPromptView('preview');
                      }
                    }}
                    disabled={isSystemTokenized}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className={cx(
                      styles.promptViewToggleButton,
                      systemPromptView === 'markdown' && styles.promptViewToggleButtonActive
                    )}
                    aria-pressed={systemPromptView === 'markdown'}
                    onClick={() => setSystemPromptView('markdown')}
                  >
                    Markdown
                  </button>
                </span>
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
              <div className={styles.systemPromptContent}>
                {detail.system_prompt.length > 0 ? (
                  tokenizedSections['system'] && encode && decode ? (
                    <div className={styles.systemPrompt}>
                      <TokenizedText text={detail.system_prompt} encode={encode} decode={decode} />
                    </div>
                  ) : systemPromptView === 'preview' ? (
                    <div className={styles.systemPromptPreview}>
                      <MarkdownPreview markdown={detail.system_prompt} />
                    </div>
                  ) : (
                    <pre className={styles.systemPrompt}>{detail.system_prompt}</pre>
                  )
                ) : (
                  <pre className={styles.systemPrompt}>No system prompt recorded.</pre>
                )}
              </div>
            </div>
            <div className={styles.sectionBlock}>
              <AgentRatingPanel
                agentName={agentName}
                version={activeVersion}
                agentStateContext={agentStateContext}
                contentView={isSystemTokenized ? 'markdown' : systemPromptView}
                onRerun={scrollToPromptAnalysis}
                onResultChange={handleRatingResultChange}
                dataSource={dataSource}
                initialResult={initialRating}
                initialLoading={initialRatingLoading || initialRating?.status === 'pending'}
                initialError={initialRatingError}
                embedded
              />
            </div>
          </div>
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
  );
}
