import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Input, Select, Spinner, Stack, Switch, useStyles2 } from '@grafana/ui';
import type { ConversationData, ConversationSpan } from '../../conversation/types';
import { selectSpansForMode, filterSpansByType, filterSpansByText, type SpanType } from '../../conversation/spans';
import SigilSpanTree from './SigilSpanTree';

export type ConversationGenerationsProps = {
  data: ConversationData;
  loading?: boolean;
  errorMessage?: string;
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: ConversationSpan | null) => void;
};

const SPAN_TYPE_OPTIONS: Array<SelectableValue<SpanType>> = [
  { label: 'Generation', value: 'generation' },
  { label: 'Tool', value: 'tool_execution' },
  { label: 'Embedding', value: 'embedding' },
  { label: 'Framework', value: 'framework' },
  { label: 'Other', value: 'unknown' },
];

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'conversationGenerations-container',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    minHeight: 0,
    padding: theme.spacing(0, 0.5, 1.5, 0.75),
  }),
  title: css({
    label: 'conversationGenerations-title',
    margin: 0,
    fontSize: theme.typography.h6.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  list: css({
    label: 'conversationGenerations-list',
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
  controls: css({
    label: 'conversationGenerations-controls',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(0, 0.25),
  }),
  toggleWrap: css({
    label: 'conversationGenerations-toggleWrap',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  }),
  toggleLabel: css({
    label: 'conversationGenerations-toggleLabel',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  searchInputWrap: css({
    label: 'conversationGenerations-searchInputWrap',
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
  }),
  searchClearButton: css({
    label: 'conversationGenerations-searchClearButton',
    position: 'absolute',
    right: theme.spacing(0.5),
    top: '50%',
    transform: 'translateY(-50%)',
    minWidth: 0,
    padding: theme.spacing(0.25, 0.5),
    lineHeight: 1,
  }),
  spinnerWrap: css({
    label: 'conversationGenerations-spinnerWrap',
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(2),
  }),
  emptyState: css({
    label: 'conversationGenerations-emptyState',
    color: theme.colors.text.secondary,
    padding: theme.spacing(1, 0),
  }),
});

export default function ConversationGenerations({
  data,
  loading = false,
  errorMessage = '',
  selectedSpanSelectionID = '',
  onSelectSpan,
}: ConversationGenerationsProps) {
  const styles = useStyles2(getStyles);
  const [showAllSpans, setShowAllSpans] = useState<boolean>(false);
  const [typeFilter, setTypeFilter] = useState<SpanType | ''>('');
  const [textFilter, setTextFilter] = useState<string>('');

  const modeFilteredSpans = useMemo(
    () => selectSpansForMode(data.spans, showAllSpans ? 'all' : 'sigil-only'),
    [data.spans, showAllSpans]
  );

  const typeFilteredSpans = useMemo(() => {
    if (typeFilter.length === 0) {
      return modeFilteredSpans;
    }
    return filterSpansByType(modeFilteredSpans, typeFilter as SpanType);
  }, [modeFilteredSpans, typeFilter]);

  const filteredSpans = useMemo(
    () => filterSpansByText(typeFilteredSpans, textFilter),
    [typeFilteredSpans, textFilter]
  );

  const hasActiveFilters = typeFilter.length > 0 || textFilter.trim().length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <h3 className={styles.title}>Generations ({data.generationCount})</h3>
        <div className={styles.toggleWrap}>
          <span className={styles.toggleLabel}>All</span>
          <Switch
            value={showAllSpans}
            onChange={(event) => {
              setShowAllSpans(event.target.checked);
            }}
            aria-label="toggle all spans"
          />
        </div>
      </div>
      <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
        <div className={styles.searchInputWrap}>
          <Input
            value={textFilter}
            onChange={(event) => {
              setTextFilter(event.currentTarget.value);
            }}
            placeholder="Type text or search spans"
            width={36}
            aria-label="search spans"
          />
          {textFilter.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className={styles.searchClearButton}
              aria-label="clear search spans"
              onClick={() => {
                setTextFilter('');
              }}
            >
              X
            </Button>
          )}
        </div>
        <Select<SpanType>
          options={SPAN_TYPE_OPTIONS}
          value={typeFilter || null}
          onChange={(selection) => {
            setTypeFilter(selection?.value ?? '');
          }}
          placeholder="Type"
          isClearable
          width={18}
        />
      </Stack>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Failed to load conversation">
          {errorMessage}
        </Alert>
      )}
      {loading ? (
        <div className={styles.spinnerWrap}>
          <Spinner aria-label="loading conversation spans" />
        </div>
      ) : data.generationCount === 0 ? (
        <div className={styles.emptyState}>No generations in this conversation.</div>
      ) : filteredSpans.length === 0 ? (
        hasActiveFilters ? (
          <div className={styles.emptyState}>No spans match the current filters.</div>
        ) : (
          <div className={styles.emptyState}>{showAllSpans ? 'No spans found.' : 'No Sigil spans found.'}</div>
        )
      ) : (
        <div className={styles.list}>
          <SigilSpanTree
            spans={filteredSpans}
            selectedSpanSelectionID={selectedSpanSelectionID}
            onSelectSpan={(span) => {
              onSelectSpan?.(span);
            }}
          />
        </div>
      )}
    </div>
  );
}
