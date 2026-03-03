import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Button, Input, Select, Spinner, Stack, Switch, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import type { GenerationDetail } from '../../conversation/types';
import {
  buildTraceSpans,
  selectSpansForMode,
  type ParsedTraceSpan,
  type SigilSpan,
  type SigilSpanKind,
} from '../../conversation/traceSpans';
import SigilSpanTree from './SigilSpanTree';

export type ConversationGenerationsProps = {
  generations: GenerationDetail[];
  loading?: boolean;
  errorMessage?: string;
  selectedSpanSelectionID?: string;
  onSelectSpan?: (span: SigilSpan | null) => void;
  onSpansLoaded?: (spans: SigilSpan[]) => void;
};

type SpanLoadState = {
  loading: boolean;
  errorMessage: string;
  spans: ParsedTraceSpan[];
};

const SIGIL_KIND_OPTIONS: Array<SelectableValue<SigilSpanKind>> = [
  { label: 'Generation', value: 'generation' },
  { label: 'Tool', value: 'tool' },
  { label: 'Model', value: 'model' },
  { label: 'Evaluation', value: 'evaluation' },
  { label: 'Other', value: 'other' },
];

function spanMatchesFreeText(span: SigilSpan, freeTextFilter: string): boolean {
  const normalized = freeTextFilter.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  const attributeText = Object.entries(span.attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
    .toLowerCase();
  const searchable = [
    span.name,
    span.serviceName,
    span.sigilKind,
    span.traceID,
    span.spanID,
    span.parentSpanID,
    attributeText,
  ]
    .join(' ')
    .toLowerCase();
  return searchable.includes(normalized);
}

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
  nestedState: css({
    label: 'conversationGenerations-nestedState',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
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
  generations,
  loading = false,
  errorMessage = '',
  selectedSpanSelectionID = '',
  onSelectSpan,
  onSpansLoaded,
}: ConversationGenerationsProps) {
  const styles = useStyles2(getStyles);
  const [showAllSpans, setShowAllSpans] = useState<boolean>(false);
  const [typeFilter, setTypeFilter] = useState<SigilSpanKind | ''>('');
  const [textFilter, setTextFilter] = useState<string>('');
  const [spanState, setSpanState] = useState<SpanLoadState>({
    loading: false,
    errorMessage: '',
    spans: [],
  });

  const loadAllGenerationSpans = useCallback(async () => {
    if (generations.length === 0) {
      setSpanState({ loading: false, errorMessage: '', spans: [] });
      return;
    }
    setSpanState({ loading: true, errorMessage: '', spans: [] });
    try {
      const uniqueTraceIDs = Array.from(
        new Set(
          generations
            .map((generation) => generation.trace_id)
            .filter((traceID): traceID is string => typeof traceID === 'string' && traceID.length > 0)
        )
      );
      const spansByTraceID: Record<string, ParsedTraceSpan[]> = {};
      await Promise.all(
        uniqueTraceIDs.map(async (traceID) => {
          const traceURL = new URL(
            `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`,
            window.location.origin
          );
          const response = await lastValueFrom(
            getBackendSrv().fetch<unknown>({
              method: 'GET',
              url: traceURL.toString(),
            })
          );
          spansByTraceID[traceID] = buildTraceSpans(traceID, response.data);
        })
      );
      const uniqueBySelectionID = new Map<string, ParsedTraceSpan>();
      for (const traceID of uniqueTraceIDs) {
        for (const span of spansByTraceID[traceID] ?? []) {
          uniqueBySelectionID.set(span.selectionID, span);
        }
      }
      setSpanState({
        loading: false,
        errorMessage: '',
        spans: Array.from(uniqueBySelectionID.values()).sort((left, right) => {
          if (left.startNs !== right.startNs) {
            return left.startNs < right.startNs ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        }),
      });
    } catch (error) {
      setSpanState({
        loading: false,
        errorMessage: error instanceof Error ? error.message : 'failed to load spans',
        spans: [],
      });
    }
  }, [generations]);

  useEffect(() => {
    const timeoutID = window.setTimeout(() => {
      void loadAllGenerationSpans();
    }, 0);
    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [loadAllGenerationSpans]);

  const visibleSpans = useMemo(
    () => selectSpansForMode(spanState.spans, showAllSpans ? 'all' : 'sigil-only'),
    [showAllSpans, spanState.spans]
  );

  const filteredSpans = useMemo(
    () =>
      visibleSpans.filter((span) => {
        if (typeFilter.length > 0 && span.sigilKind !== typeFilter) {
          return false;
        }
        return spanMatchesFreeText(span, textFilter);
      }),
    [textFilter, typeFilter, visibleSpans]
  );

  const hasActiveFilters = typeFilter.length > 0 || textFilter.trim().length > 0;

  const allSelectableSpans = useMemo(() => selectSpansForMode(spanState.spans, 'all'), [spanState.spans]);

  useEffect(() => {
    onSpansLoaded?.(allSelectableSpans);
  }, [allSelectableSpans, onSpansLoaded]);

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <h3 className={styles.title}>Spans ({filteredSpans.length})</h3>
        <div className={styles.toggleWrap}>
          <span className={styles.toggleLabel}>All</span>
          <Switch
            value={showAllSpans}
            onChange={(event) => setShowAllSpans(event.target.checked)}
            aria-label="toggle all spans"
          />
        </div>
      </div>
      <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
        <div className={styles.searchInputWrap}>
          <Input
            value={textFilter}
            onChange={(event) => setTextFilter(event.currentTarget.value)}
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
              onClick={() => setTextFilter('')}
            >
              X
            </Button>
          )}
        </div>
        <Select<SigilSpanKind>
          options={SIGIL_KIND_OPTIONS}
          value={typeFilter || null}
          onChange={(selection) => setTypeFilter(selection?.value ?? '')}
          placeholder="Type"
          isClearable
          width={18}
        />
      </Stack>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Failed to load generations">
          {errorMessage}
        </Alert>
      )}
      {loading || spanState.loading ? (
        <div className={styles.spinnerWrap}>
          <Spinner aria-label="loading conversation spans" />
        </div>
      ) : spanState.errorMessage.length > 0 ? (
        <Alert severity="error" title="Failed to load spans">
          {spanState.errorMessage}
        </Alert>
      ) : generations.length === 0 ? (
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
            onSelectSpan={(span) => onSelectSpan?.(span)}
          />
        </div>
      )}
    </div>
  );
}
