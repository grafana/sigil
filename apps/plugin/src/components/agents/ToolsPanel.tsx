import React, { useMemo, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Input, Stack, Text, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import { JsonView, type Props as JsonViewProps } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import type { AgentTool } from '../../agents/types';
import { TokenizedText } from '../tokenizer/TokenizedText';
import { AVAILABLE_ENCODINGS, type EncodingName } from '../tokenizer/encodingMap';
import { getTokenizeControlStyles } from '../tokenizer/tokenizeControls.styles';

export type ToolsPanelProps = {
  tools: AgentTool[];
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
  toolTokens: css({
    flexShrink: 0,
    fontSize: 11,
    color: theme.colors.text.disabled,
    fontVariantNumeric: 'tabular-nums',
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
  schemaContainer: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: theme.spacing(1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    overflowX: 'auto',
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

function shouldExpandNode(level: number): boolean {
  return level < 2;
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

function buildToolKey(tool: AgentTool): string {
  return [tool.name, tool.type, tool.input_schema_json].join('\u0000');
}

export default function ToolsPanel({
  tools,
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
  const [filter, setFilter] = useState('');
  const [sortField, setSortField] = useState<'name' | 'tokens'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
        {onToggleTokenize && (
          <span style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
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
          </span>
        )}
      </div>

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
                className={cx(styles.toolRow, originalIndex === selectedIndex && styles.toolRowActive)}
                onClick={() => setSelectedToolKey(buildToolKey(tool))}
                aria-label={`select tool ${tool.name}`}
                aria-pressed={originalIndex === selectedIndex}
              >
                <span className={styles.toolName}>{tool.name}</span>
                <span className={styles.toolTokens}>{tool.token_estimate.toLocaleString()} tok</span>
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
            </div>

            {selected.description.length > 0 && (
              <div>
                <div className={styles.sectionLabel}>Description</div>
                {tokenized && encode && decode ? (
                  <div className={styles.detailDescription}>
                    <TokenizedText text={selected.description} encode={encode} decode={decode} />
                  </div>
                ) : (
                  <div className={styles.detailDescription}>{selected.description}</div>
                )}
              </div>
            )}

            <div>
              <div className={styles.sectionLabel}>Input schema</div>
              <div className={styles.schemaContainer}>
                <JsonView data={parsedSchema} style={jsonStyle} shouldExpandNode={shouldExpandNode} clickToExpandNode />
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.emptyDetail}>
            <Icon name="brackets-curly" size="xl" />
            <Text color="secondary">Select a tool to view its details</Text>
          </div>
        )}
      </div>
    </div>
  );
}
