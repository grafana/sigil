import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Spinner, Switch, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import type { GenerationDetail } from '../../conversation/types';
import type { ParsedTraceSpan, SigilSpan } from '../../conversation/traceSpans';
import { buildTraceSpans, selectSpansForMode } from '../../conversation/traceSpans';
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
    void loadAllGenerationSpans();
  }, [loadAllGenerationSpans]);

  const visibleSpans = useMemo(
    () => selectSpansForMode(spanState.spans, showAllSpans ? 'all' : 'sigil-only'),
    [showAllSpans, spanState.spans]
  );

  const allSelectableSpans = useMemo(() => selectSpansForMode(spanState.spans, 'all'), [spanState.spans]);

  useEffect(() => {
    onSpansLoaded?.(allSelectableSpans);
  }, [allSelectableSpans, onSpansLoaded]);

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <h3 className={styles.title}>Spans ({visibleSpans.length})</h3>
        <div className={styles.toggleWrap}>
          <span className={styles.toggleLabel}>All</span>
          <Switch
            value={showAllSpans}
            onChange={(event) => setShowAllSpans(event.target.checked)}
            aria-label="toggle all spans"
          />
        </div>
      </div>
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
      ) : visibleSpans.length === 0 ? (
        <div className={styles.emptyState}>{showAllSpans ? 'No spans found.' : 'No Sigil spans found.'}</div>
      ) : (
        <div className={styles.list}>
          <SigilSpanTree
            spans={visibleSpans}
            selectedSpanSelectionID={selectedSpanSelectionID}
            onSelectSpan={(span) => onSelectSpan?.(span)}
          />
        </div>
      )}
    </div>
  );
}
