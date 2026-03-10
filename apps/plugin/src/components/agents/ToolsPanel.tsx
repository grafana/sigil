import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Input, Stack, Tab, TabsBar, Text, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import { JsonView, type Props as JsonViewProps } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import type { AgentTool } from '../../agents/types';
import { TokenizedText } from '../tokenizer/TokenizedText';
import { AVAILABLE_ENCODINGS, type EncodingName } from '../tokenizer/encodingMap';
import { getTokenizeControlStyles } from '../tokenizer/tokenizeControls.styles';
import { computeDiffLines } from './PromptDiffView';

export type ToolsPanelProps = {
  tools: AgentTool[];
  previousTools?: AgentTool[] | null;
  tokenized?: boolean;
  onToggleTokenize?: () => void;
  tokenizerLoading?: boolean;
  autoEncoding?: EncodingName;
  encodingOverride?: EncodingName | null;
  onEncodingChange?: (encoding: EncodingName | null) => void;
  encode?: (text: string) => number[];
  decode?: (ids: number[]) => string;
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    overflow: 'hidden',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  headerCount: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    height: 20,
    padding: `0 ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.border.weak,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    lineHeight: 1,
  }),
  body: css({
    display: 'flex',
    minHeight: 320,
    maxHeight: 580,
  }),
  sidebar: css({
    width: 280,
    flexShrink: 0,
    borderRight: `1px solid ${theme.colors.border.weak}`,
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  sidebarSearch: css({
    padding: theme.spacing(0.75),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
  }),
  sortBar: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(0.25)} ${theme.spacing(1.25)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
  }),
  sortButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    background: 'none',
    border: 'none',
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.disabled,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    transition: 'color 80ms ease',
    '&:hover': {
      color: theme.colors.text.secondary,
    },
  }),
  sortButtonActive: css({
    color: theme.colors.text.primary,
  }),
  sidebarList: css({
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  }),
  toolRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    width: '100%',
    textAlign: 'left' as const,
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.25)}`,
    paddingLeft: `calc(${theme.spacing(1.25)} + 2px)`,
    border: 'none',
    borderLeft: '2px solid transparent',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    background: 'transparent',
    transition: 'background 80ms ease',
    '&:hover': {
      background: theme.colors.action.hover,
    },
    '&:last-child': {
      borderBottom: 'none',
    },
  }),
  toolRowDeferred: css({
    background: `${theme.colors.action.disabledBackground}55`,
    '&:hover': {
      background: `${theme.colors.action.disabledBackground}75`,
    },
  }),
  toolRowActive: css({
    background: theme.colors.primary.transparent,
    borderLeftColor: theme.colors.primary.main,
    paddingLeft: theme.spacing(1.25),
    '&:hover': {
      background: theme.colors.primary.transparent,
    },
  }),
  toolName: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    lineHeight: 1.4,
  }),
  toolNameDeferred: css({
    color: theme.colors.text.secondary,
  }),
  toolMeta: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexShrink: 0,
  }),
  toolDeferredDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: theme.colors.warning.main,
    flexShrink: 0,
  }),
  toolDeferredBadge: css({
    display: 'inline-flex',
    alignItems: 'center',
    padding: `0 ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.warning.border}`,
    background: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
    fontSize: 10,
    fontWeight: theme.typography.fontWeightMedium,
    letterSpacing: '0.03em',
    textTransform: 'uppercase' as const,
    lineHeight: 1.6,
  }),
  toolTokens: css({
    flexShrink: 0,
    fontSize: 11,
    color: theme.colors.text.disabled,
    fontVariantNumeric: 'tabular-nums',
  }),
  toolTokensDeferred: css({
    color: theme.colors.text.secondary,
  }),
  detail: css({
    flex: 1,
    minWidth: 0,
    overflowY: 'auto',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  detailTitle: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    wordBreak: 'break-all' as const,
  }),
  detailType: css({
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.border.weak,
    fontSize: 11,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  }),
  detailTokensRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  detailExecutionMode: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  detailExecutionModePill: css({
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${theme.spacing(0.125)} ${theme.spacing(0.625)}`,
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.action.hover,
    color: theme.colors.text.secondary,
    fontSize: 11,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.6,
  }),
  detailExecutionModePillDeferred: css({
    borderColor: theme.colors.warning.border,
    background: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
  }),
  detailDescription: css({
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    color: theme.colors.text.secondary,
    whiteSpace: 'pre-wrap' as const,
  }),
  sectionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
    letterSpacing: '0.03em',
    textTransform: 'uppercase' as const,
  }),
  detailTabs: css({
    marginTop: `-${theme.spacing(1)}`,
    marginBottom: `-${theme.spacing(0.5)}`,
  }),
  descriptionCode: css({
    margin: 0,
    minHeight: 220,
    maxHeight: 420,
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
    '& code': {
      fontFamily: 'inherit',
    },
  }),
  schemaContainer: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    overflowX: 'auto',
  }),
  diffBody: css({
    flex: 1,
    overflowY: 'auto',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    minHeight: 320,
    maxHeight: 580,
  }),
  diffSummaryBar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1, 1.5),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
    flexWrap: 'wrap' as const,
  }),
  diffSummaryAdded: css({ color: theme.colors.success.text }),
  diffSummaryRemoved: css({ color: theme.colors.error.text }),
  diffSummaryModified: css({ color: theme.colors.warning.text }),
  diffSummaryUnchanged: css({ color: theme.colors.text.secondary }),
  diffGroup: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
  }),
  diffGroupTitle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  }),
  diffToolEntry: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    overflow: 'hidden',
  }),
  diffToolHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(0.75, 1.25),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    cursor: 'default',
  }),
  diffToolHeaderExpandable: css({
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  diffToolTokenDelta: css({
    marginLeft: 'auto',
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    color: theme.colors.text.secondary,
  }),
  diffToolDetail: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.25),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  diffSectionLabel: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  }),
  diffSectionStats: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
  }),
  diffStatAdded: css({ color: theme.colors.success.text }),
  diffStatRemoved: css({ color: theme.colors.error.text }),
  diffPre: css({
    margin: 0,
    maxHeight: 240,
    overflow: 'auto',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    padding: 0,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    lineHeight: 1.6,
    color: theme.colors.text.primary,
  }),
  diffLineEqual: css({
    display: 'flex',
    minHeight: '1.6em',
  }),
  diffLineAdd: css({
    display: 'flex',
    minHeight: '1.6em',
    backgroundColor: `${theme.colors.success.main}1A`,
    borderLeft: `3px solid ${theme.colors.success.main}`,
  }),
  diffLineRemove: css({
    display: 'flex',
    minHeight: '1.6em',
    backgroundColor: `${theme.colors.error.main}1A`,
    borderLeft: `3px solid ${theme.colors.error.main}`,
  }),
  diffGutter: css({
    display: 'inline-block',
    width: 24,
    minWidth: 24,
    textAlign: 'center' as const,
    color: theme.colors.text.secondary,
    userSelect: 'none' as const,
    flexShrink: 0,
  }),
  diffLineText: css({
    flex: 1,
    minWidth: 0,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
    paddingRight: theme.spacing(1),
  }),
  diffNoChanges: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  emptyDetail: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    color: theme.colors.text.disabled,
    padding: theme.spacing(4),
  }),
  empty: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    color: theme.colors.text.disabled,
  }),
  ...getTokenizeControlStyles(theme),
});

function buildJsonViewStyle(theme: GrafanaTheme2): JsonViewProps['style'] {
  return {
    container: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.size.sm,
      lineHeight: 1.6,
      background: 'transparent',
    }),
    basicChildStyle: css({ marginLeft: 16 }),
    label: css({
      color: theme.colors.primary.text,
      marginRight: 4,
      fontWeight: 600,
    }),
    clickableLabel: css({ cursor: 'pointer' }),
    nullValue: css({ color: theme.colors.text.disabled }),
    undefinedValue: css({ color: theme.colors.text.disabled }),
    numberValue: css({ color: theme.colors.success.text }),
    stringValue: css({ color: theme.colors.warning.text }),
    booleanValue: css({ color: theme.colors.info.text }),
    otherValue: css({ color: theme.colors.text.secondary }),
    punctuation: css({ color: theme.colors.text.secondary }),
    expandIcon: css({
      cursor: 'pointer',
      marginRight: 6,
      userSelect: 'none' as const,
      fontSize: 0,
      lineHeight: 0,
      '&::before': {
        content: '"+"',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 3,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        color: theme.colors.text.secondary,
        background: theme.colors.action.hover,
        border: `1px solid ${theme.colors.border.weak}`,
        transition: 'color 80ms, background 80ms',
      },
      '&:hover::before': {
        color: theme.colors.text.primary,
        background: theme.colors.action.focus,
      },
    }),
    collapseIcon: css({
      cursor: 'pointer',
      marginRight: 6,
      userSelect: 'none' as const,
      fontSize: 0,
      lineHeight: 0,
      '&::before': {
        content: '"−"',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 3,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        color: theme.colors.text.secondary,
        background: theme.colors.action.hover,
        border: `1px solid ${theme.colors.border.weak}`,
        transition: 'color 80ms, background 80ms',
      },
      '&:hover::before': {
        color: theme.colors.text.primary,
        background: theme.colors.action.focus,
      },
    }),
    collapsedContent: css({
      cursor: 'pointer',
      color: theme.colors.text.disabled,
      fontSize: '0.85em',
      marginRight: 4,
      '&:hover': {
        color: theme.colors.text.secondary,
      },
    }),
    childFieldsContainer: css({ margin: 0, padding: 0 }),
    noQuotesForStringValues: false,
    quotesForFieldNames: true,
    stringifyStringValues: false,
    ariaLables: { collapseJson: 'Collapse', expandJson: 'Expand' },
  };
}

function shouldExpandNode(): boolean {
  return true;
}

function parseSchema(raw: string): object {
  if (!raw || raw.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(raw) as object;
  } catch {
    return {};
  }
}

function formatSchemaForDiff(raw: string): string {
  if (!raw || raw.trim() === '') {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function buildToolKey(tool: AgentTool): string {
  return [tool.name, tool.type, tool.input_schema_json].join('\u0000');
}

type ToolChangeSummary = {
  added: AgentTool[];
  removed: AgentTool[];
  modified: Array<{ current: AgentTool; previous: AgentTool }>;
  unchanged: AgentTool[];
};

function computeToolChanges(current: AgentTool[], previous: AgentTool[]): ToolChangeSummary {
  const prevByName = new Map<string, AgentTool>();
  for (const tool of previous) {
    prevByName.set(tool.name, tool);
  }
  const currentNames = new Set(current.map((t) => t.name));

  const added: AgentTool[] = [];
  const modified: Array<{ current: AgentTool; previous: AgentTool }> = [];
  const unchanged: AgentTool[] = [];

  for (const tool of current) {
    const prev = prevByName.get(tool.name);
    if (!prev) {
      added.push(tool);
    } else if (
      prev.description !== tool.description ||
      formatSchemaForDiff(prev.input_schema_json) !== formatSchemaForDiff(tool.input_schema_json)
    ) {
      modified.push({ current: tool, previous: prev });
    } else {
      unchanged.push(tool);
    }
  }

  const removed = previous.filter((t) => !currentNames.has(t.name));

  return { added, removed, modified, unchanged };
}

type InlineDiffProps = {
  label: string;
  oldText: string;
  newText: string;
  styles: ReturnType<typeof getStyles>;
};

function InlineDiff({ label, oldText, newText, styles }: InlineDiffProps) {
  const lines = useMemo(() => computeDiffLines(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => {
    let a = 0;
    let r = 0;
    for (const line of lines) {
      if (line.type === 'add') {
        a++;
      }
      if (line.type === 'remove') {
        r++;
      }
    }
    return { added: a, removed: r };
  }, [lines]);

  if (stats.added === 0 && stats.removed === 0) {
    return null;
  }

  return (
    <div>
      <div className={styles.diffSectionLabel}>
        <Text variant="bodySmall" weight="medium" color="secondary">
          {label}
        </Text>
        <div className={styles.diffSectionStats}>
          {stats.added > 0 && <span className={styles.diffStatAdded}>+{stats.added}</span>}
          {stats.removed > 0 && <span className={styles.diffStatRemoved}>-{stats.removed}</span>}
        </div>
      </div>
      <pre className={styles.diffPre}>
        {lines.map((line, idx) => {
          let cls = styles.diffLineEqual;
          let g = ' ';
          if (line.type === 'add') {
            cls = styles.diffLineAdd;
            g = '+';
          } else if (line.type === 'remove') {
            cls = styles.diffLineRemove;
            g = '-';
          }
          return (
            <div key={idx} className={cls}>
              <span className={styles.diffGutter}>{g}</span>
              <span className={styles.diffLineText}>{line.text || '\n'}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function ModifiedToolEntry({
  current,
  previous,
  styles,
}: {
  current: AgentTool;
  previous: AgentTool;
  styles: ReturnType<typeof getStyles>;
}) {
  const [expanded, setExpanded] = useState(true);
  const tokenDelta = current.token_estimate - previous.token_estimate;
  const descChanged = current.description !== previous.description;
  const schemaChanged =
    formatSchemaForDiff(current.input_schema_json) !== formatSchemaForDiff(previous.input_schema_json);

  return (
    <div className={styles.diffToolEntry}>
      <div
        className={cx(styles.diffToolHeader, styles.diffToolHeaderExpandable)}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setExpanded((v) => !v);
          }
        }}
      >
        <Icon name={expanded ? 'angle-down' : 'angle-right'} size="sm" />
        <span>{current.name}</span>
        {tokenDelta !== 0 && (
          <span className={styles.diffToolTokenDelta}>
            {tokenDelta > 0 ? '+' : ''}
            {tokenDelta.toLocaleString()} tok
          </span>
        )}
      </div>
      {expanded && (
        <div className={styles.diffToolDetail}>
          {descChanged && (
            <InlineDiff
              label="Description"
              oldText={previous.description}
              newText={current.description}
              styles={styles}
            />
          )}
          {schemaChanged && (
            <InlineDiff
              label="Input schema"
              oldText={formatSchemaForDiff(previous.input_schema_json)}
              newText={formatSchemaForDiff(current.input_schema_json)}
              styles={styles}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ToolsDiffView({
  tools,
  previousTools,
  styles,
}: {
  tools: AgentTool[];
  previousTools: AgentTool[];
  styles: ReturnType<typeof getStyles>;
}) {
  const changes = useMemo(() => computeToolChanges(tools, previousTools), [tools, previousTools]);
  const hasAnyChange = changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0;

  if (!hasAnyChange) {
    return (
      <div className={styles.diffBody}>
        <div className={styles.diffNoChanges}>
          <Icon name="check-circle" />
          <Text color="secondary" variant="bodySmall">
            No tool changes between versions.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.diffBody}>
      <div className={styles.diffSummaryBar}>
        {changes.added.length > 0 && <span className={styles.diffSummaryAdded}>{changes.added.length} added</span>}
        {changes.removed.length > 0 && (
          <span className={styles.diffSummaryRemoved}>{changes.removed.length} removed</span>
        )}
        {changes.modified.length > 0 && (
          <span className={styles.diffSummaryModified}>{changes.modified.length} modified</span>
        )}
        {changes.unchanged.length > 0 && (
          <span className={styles.diffSummaryUnchanged}>{changes.unchanged.length} unchanged</span>
        )}
      </div>

      {changes.added.length > 0 && (
        <div className={styles.diffGroup}>
          <div className={cx(styles.diffGroupTitle, styles.diffSummaryAdded)}>
            <Icon name="plus-circle" size="sm" />
            Added
          </div>
          {changes.added.map((tool) => (
            <div key={tool.name} className={styles.diffToolEntry}>
              <div className={styles.diffToolHeader}>
                <Icon name="plus" size="xs" />
                <span>{tool.name}</span>
                <span className={styles.diffToolTokenDelta}>+{tool.token_estimate.toLocaleString()} tok</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {changes.removed.length > 0 && (
        <div className={styles.diffGroup}>
          <div className={cx(styles.diffGroupTitle, styles.diffSummaryRemoved)}>
            <Icon name="minus-circle" size="sm" />
            Removed
          </div>
          {changes.removed.map((tool) => (
            <div key={tool.name} className={styles.diffToolEntry}>
              <div className={styles.diffToolHeader}>
                <Icon name="minus" size="xs" />
                <span>{tool.name}</span>
                <span className={styles.diffToolTokenDelta}>-{tool.token_estimate.toLocaleString()} tok</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {changes.modified.length > 0 && (
        <div className={styles.diffGroup}>
          <div className={cx(styles.diffGroupTitle, styles.diffSummaryModified)}>
            <Icon name="pen" size="sm" />
            Modified
          </div>
          {changes.modified.map(({ current, previous }) => (
            <ModifiedToolEntry key={current.name} current={current} previous={previous} styles={styles} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ToolsPanel({
  tools,
  previousTools,
  tokenized,
  onToggleTokenize,
  tokenizerLoading,
  autoEncoding,
  encodingOverride,
  onEncodingChange,
  encode,
  decode,
}: ToolsPanelProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const jsonStyle = useMemo(() => buildJsonViewStyle(theme), [theme]);

  const [selectedToolKey, setSelectedToolKey] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'description' | 'schema'>('description');
  const [filter, setFilter] = useState('');
  const [sortField, setSortField] = useState<'name' | 'tokens'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showDiff, setShowDiff] = useState(false);

  const hasPreviousTools = previousTools != null && previousTools.length > 0;

  const toggleSort = (field: 'name' | 'tokens') => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'tokens' ? 'desc' : 'asc');
    }
  };

  const filteredTools = useMemo(() => {
    let items = tools.map((tool, idx) => ({ tool, originalIndex: idx }));
    if (filter.trim().length > 0) {
      const lower = filter.toLowerCase();
      items = items.filter(({ tool }) => tool.name.toLowerCase().includes(lower));
    }
    items.sort((a, b) => {
      let cmp: number;
      if (sortField === 'tokens') {
        cmp = a.tool.token_estimate - b.tool.token_estimate;
      } else {
        cmp = a.tool.name.localeCompare(b.tool.name);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return items;
  }, [tools, filter, sortField, sortDir]);

  const selectedIndex = useMemo(() => {
    if (tools.length === 0) {
      return -1;
    }
    const filteredDefault = filteredTools.length > 0 ? filteredTools[0].originalIndex : -1;
    if (selectedToolKey === null) {
      return filteredDefault;
    }
    const index = tools.findIndex((tool) => buildToolKey(tool) === selectedToolKey);
    if (index < 0 || !filteredTools.some(({ originalIndex }) => originalIndex === index)) {
      return filteredDefault;
    }
    return index;
  }, [tools, filteredTools, selectedToolKey]);

  const selected = selectedIndex >= 0 ? tools[selectedIndex] : null;

  const parsedSchema = useMemo(() => {
    if (!selected) {
      return {};
    }
    return parseSchema(selected.input_schema_json);
  }, [selected]);

  if (tools.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Text weight="medium">Tools</Text>
            <span className={styles.headerCount}>0</span>
          </Stack>
        </div>
        <div className={styles.empty}>
          <Icon name="brackets-curly" size="xl" />
          <Text color="secondary" variant="bodySmall">
            No tools captured for this version.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Text weight="medium">Tools</Text>
          <span className={styles.headerCount}>{tools.length}</span>
        </Stack>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          {hasPreviousTools && (
            <span
              className={cx(styles.tokenizeBtn, showDiff && styles.tokenizeBtnActive)}
              onClick={() => setShowDiff((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setShowDiff((v) => !v);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={showDiff}
              aria-label="Toggle tool diff view"
            >
              <Icon name="code-branch" size="xs" />
              Diff
            </span>
          )}
          {onToggleTokenize && (
            <>
              <span
                className={cx(styles.tokenizeBtn, tokenized && styles.tokenizeBtnActive)}
                onClick={onToggleTokenize}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onToggleTokenize();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <Icon name="brackets-curly" size="xs" />
                {tokenizerLoading ? 'Loading\u2026' : 'Tokenize'}
              </span>
              {tokenized && onEncodingChange && (
                <select
                  className={styles.encodingSelect}
                  aria-label="Tokenizer encoding"
                  value={encodingOverride ?? ''}
                  onChange={(e) => onEncodingChange(e.target.value ? (e.target.value as EncodingName) : null)}
                >
                  <option value="">Auto ({(autoEncoding ?? 'cl100k').replace('_base', '')})</option>
                  {AVAILABLE_ENCODINGS.map((enc) => (
                    <option key={enc.value} value={enc.value}>
                      {enc.value.replace('_base', '')}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </span>
      </div>

      {showDiff && hasPreviousTools ? (
        <ToolsDiffView tools={tools} previousTools={previousTools!} styles={styles} />
      ) : (
        <div className={styles.body}>
          <div className={styles.sidebar}>
            {tools.length > 6 && (
              <div className={styles.sidebarSearch}>
                <Input
                  prefix={<Icon name="search" />}
                  placeholder="Filter tools…"
                  value={filter}
                  onChange={(e) => setFilter(e.currentTarget.value)}
                />
              </div>
            )}
            <div className={styles.sortBar}>
              <button
                type="button"
                className={cx(styles.sortButton, sortField === 'name' && styles.sortButtonActive)}
                onClick={() => toggleSort('name')}
                aria-label={`sort by name ${sortField === 'name' ? sortDir : ''}`}
              >
                Name
                {sortField === 'name' && <Icon name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size="xs" />}
              </button>
              <button
                type="button"
                className={cx(styles.sortButton, sortField === 'tokens' && styles.sortButtonActive)}
                onClick={() => toggleSort('tokens')}
                aria-label={`sort by tokens ${sortField === 'tokens' ? sortDir : ''}`}
              >
                Tokens
                {sortField === 'tokens' && <Icon name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size="xs" />}
              </button>
            </div>
            <div className={styles.sidebarList}>
              {filteredTools.map(({ tool, originalIndex }) => (
                <button
                  key={`${buildToolKey(tool)}:${originalIndex}`}
                  type="button"
                  className={cx(
                    styles.toolRow,
                    tool.deferred && styles.toolRowDeferred,
                    originalIndex === selectedIndex && styles.toolRowActive
                  )}
                  onClick={() => setSelectedToolKey(buildToolKey(tool))}
                  aria-label={`select tool ${tool.name}`}
                  aria-pressed={originalIndex === selectedIndex}
                >
                  <span className={cx(styles.toolName, tool.deferred && styles.toolNameDeferred)}>{tool.name}</span>
                  <span className={styles.toolMeta}>
                    {tool.deferred && <span className={styles.toolDeferredDot} aria-label="deferred tool" />}
                    <span className={cx(styles.toolTokens, tool.deferred && styles.toolTokensDeferred)}>
                      {tool.token_estimate.toLocaleString()} tok
                    </span>
                  </span>
                </button>
              ))}
              {filteredTools.length === 0 && (
                <div className={styles.empty}>
                  <Text color="secondary" variant="bodySmall">
                    No tools match &ldquo;{filter}&rdquo;
                  </Text>
                </div>
              )}
            </div>
          </div>

          {selected !== null ? (
            <div className={styles.detail}>
              <div>
                <Stack direction="row" alignItems="center" gap={1} wrap="wrap">
                  <span className={styles.detailTitle}>{selected.name}</span>
                  <span className={styles.detailType}>{selected.type}</span>
                </Stack>
                <div className={styles.detailTokensRow}>
                  <Tooltip content="Estimated tokens consumed by this tool's schema definition" placement="top">
                    <Stack direction="row" alignItems="center" gap={0.5}>
                      <Icon name="database" size="xs" />
                      <span>{selected.token_estimate.toLocaleString()} tokens</span>
                    </Stack>
                  </Tooltip>
                </div>
                <div className={styles.detailExecutionMode}>
                  <span>Execution mode:</span>
                  <span
                    className={cx(
                      styles.detailExecutionModePill,
                      selected.deferred && styles.detailExecutionModePillDeferred
                    )}
                  >
                    {selected.deferred ? 'Deferred' : 'Immediate'}
                  </span>
                </div>
              </div>

              <div className={styles.detailTabs}>
                <TabsBar>
                  <Tab
                    label="Description"
                    active={detailTab === 'description'}
                    onChangeTab={() => setDetailTab('description')}
                  />
                  <Tab
                    label="Input schema"
                    active={detailTab === 'schema'}
                    onChangeTab={() => setDetailTab('schema')}
                  />
                </TabsBar>
              </div>

              {detailTab === 'description' && (
                <div>
                  {tokenized && encode && decode && selected.description.length > 0 ? (
                    <pre className={styles.descriptionCode}>
                      <TokenizedText text={selected.description} encode={encode} decode={decode} />
                    </pre>
                  ) : (
                    <pre className={styles.descriptionCode}>
                      {selected.description.length > 0 ? selected.description : 'No description recorded.'}
                    </pre>
                  )}
                </div>
              )}

              {detailTab === 'schema' && (
                <div>
                  <div className={styles.sectionLabel}>Input schema</div>
                  <div className={styles.schemaContainer}>
                    <JsonView
                      data={parsedSchema}
                      style={jsonStyle}
                      shouldExpandNode={shouldExpandNode}
                      clickToExpandNode
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.emptyDetail}>
              <Icon name="brackets-curly" size="xl" />
              <Text color="secondary">Select a tool to view its details</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
