import React, { useCallback, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Icon, Spinner, Text, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import type { GenerationDetail } from '../../conversation/types';
import { buildTraceSpans } from './ConversationTraces';

export type ConversationGenerationsProps = {
  generations: GenerationDetail[];
  loading?: boolean;
  errorMessage?: string;
};

type GenerationSpanLoadState = {
  loading: boolean;
  errorMessage: string;
  spans: Array<{
    id: string;
    name: string;
    serviceName: string;
  }>;
};

function formatTimestamp(value?: string): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function formatModel(value: GenerationDetail): string {
  if (value.model?.provider && value.model?.name) {
    return `${value.model.provider}/${value.model.name}`;
  }
  return value.model?.name ?? '-';
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTokenUsage(value: GenerationDetail): string {
  const usage = value.usage as Record<string, unknown> | undefined;
  if (!usage) {
    return '-';
  }
  const totalTokens = parseNumericValue(usage.total_tokens ?? usage.totalTokens);
  if (totalTokens != null) {
    return totalTokens.toLocaleString();
  }
  const inputTokens = parseNumericValue(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = parseNumericValue(usage.output_tokens ?? usage.outputTokens);
  if (inputTokens != null || outputTokens != null) {
    return `${inputTokens ?? 0}/${outputTokens ?? 0}`;
  }
  return '-';
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
    gap: 0,
  }),
  generationRowWrap: css({
    label: 'conversationGenerations-generationRowWrap',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  generationRow: css({
    label: 'conversationGenerations-generationRow',
    width: '100%',
    border: 0,
    background: 'transparent',
    textAlign: 'left' as const,
    cursor: 'pointer',
    padding: theme.spacing(0.75, 0.5),
    display: 'grid',
    gridTemplateColumns: 'auto auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  generationIcon: css({
    label: 'conversationGenerations-generationIcon',
    color: theme.colors.primary.text,
  }),
  generationMain: css({
    label: 'conversationGenerations-generationMain',
    display: 'grid',
    gap: theme.spacing(0.25),
    minWidth: 0,
  }),
  generationHeadline: css({
    label: 'conversationGenerations-generationHeadline',
    display: 'flex',
    gap: theme.spacing(0.75),
    alignItems: 'center',
    minWidth: 0,
  }),
  generationID: css({
    label: 'conversationGenerations-generationID',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
  generationMeta: css({
    label: 'conversationGenerations-generationMeta',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
  generationMetaError: css({
    label: 'conversationGenerations-generationMetaError',
    color: theme.colors.error.main,
  }),
  nestedSpans: css({
    label: 'conversationGenerations-nestedSpans',
    margin: theme.spacing(0.25, 0, 0.75, 2.75),
    paddingLeft: theme.spacing(1),
    borderLeft: `1px dashed ${theme.colors.border.medium}`,
    display: 'grid',
    gap: theme.spacing(0.25),
  }),
  nestedState: css({
    label: 'conversationGenerations-nestedState',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  spanRow: css({
    label: 'conversationGenerations-spanRow',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0),
  }),
  spanIcon: css({
    label: 'conversationGenerations-spanIcon',
    color: theme.colors.text.secondary,
  }),
  spanName: css({
    label: 'conversationGenerations-spanName',
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
  }),
  spanService: css({
    label: 'conversationGenerations-spanService',
    marginLeft: theme.spacing(0.5),
    color: theme.colors.text.secondary,
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
}: ConversationGenerationsProps) {
  const styles = useStyles2(getStyles);
  const [expandedGenerationIDs, setExpandedGenerationIDs] = useState<string[]>([]);
  const [spanStatesByGenerationID, setSpanStatesByGenerationID] = useState<Record<string, GenerationSpanLoadState>>({});

  const loadGenerationSpans = useCallback(async (generation: GenerationDetail) => {
    const generationID = generation.generation_id;
    const traceID = typeof generation.trace_id === 'string' ? generation.trace_id : '';
    if (traceID.length === 0) {
      setSpanStatesByGenerationID((current) => ({
        ...current,
        [generationID]: {
          loading: false,
          errorMessage: '',
          spans: [],
        },
      }));
      return;
    }
    setSpanStatesByGenerationID((current) => ({
      ...current,
      [generationID]: {
        loading: true,
        errorMessage: '',
        spans: [],
      },
    }));

    const traceURL = new URL(
      `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`,
      window.location.origin
    );
    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<unknown>({
          method: 'GET',
          url: traceURL.toString(),
        })
      );
      const spans = buildTraceSpans(traceID, response.data).map((span, index) => ({
        id: span.spanID.length > 0 ? span.spanID : `${traceID}-${index}`,
        name: span.name,
        serviceName: span.serviceName,
      }));
      setSpanStatesByGenerationID((current) => ({
        ...current,
        [generationID]: {
          loading: false,
          errorMessage: '',
          spans,
        },
      }));
    } catch (error) {
      setSpanStatesByGenerationID((current) => ({
        ...current,
        [generationID]: {
          loading: false,
          errorMessage: error instanceof Error ? error.message : 'failed to load spans',
          spans: [],
        },
      }));
    }
  }, []);

  const onToggleGeneration = useCallback(
    (generation: GenerationDetail) => {
      const generationID = generation.generation_id;
      setExpandedGenerationIDs((current) => {
        const isExpanded = current.includes(generationID);
        if (isExpanded) {
          return current.filter((id) => id !== generationID);
        }
        return [...current, generationID];
      });
      const existingState = spanStatesByGenerationID[generationID];
      if (!existingState) {
        void loadGenerationSpans(generation);
      }
    },
    [loadGenerationSpans, spanStatesByGenerationID]
  );

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Generations ({generations.length})</h3>
      {errorMessage.length > 0 && <Alert severity="error" title="Failed to load generations">{errorMessage}</Alert>}
      {loading ? (
        <div className={styles.spinnerWrap}>
          <Spinner aria-label="loading conversation generations" />
        </div>
      ) : generations.length === 0 ? (
        <div className={styles.emptyState}>No generations in this conversation.</div>
      ) : (
        <div className={styles.list}>
          {generations.map((generation) => {
            const hasError = Boolean(generation.error?.message);
            const generationID = generation.generation_id;
            const isExpanded = expandedGenerationIDs.includes(generationID);
            const spanState = spanStatesByGenerationID[generationID];
            const model = formatModel(generation);
            const createdAt = formatTimestamp(generation.created_at);
            const tokens = formatTokenUsage(generation);
            const status = hasError ? 'error' : 'ok';
            return (
              <div key={generationID} className={styles.generationRowWrap}>
                <button
                  type="button"
                  className={styles.generationRow}
                  aria-expanded={isExpanded}
                  aria-label={`toggle generation ${generationID}`}
                  onClick={() => onToggleGeneration(generation)}
                >
                  <Icon name={isExpanded ? 'angle-down' : 'angle-right'} />
                  <Icon className={styles.generationIcon} name="cube" />
                  <div className={styles.generationMain}>
                    <div className={styles.generationHeadline}>
                      <span className={styles.generationID}>{generationID}</span>
                    </div>
                    <div className={`${styles.generationMeta} ${hasError ? styles.generationMetaError : ''}`}>
                      <Text color={hasError ? 'error' : 'secondary'}>
                        {model} • {createdAt} • {tokens} tokens • {status}
                      </Text>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className={styles.nestedSpans}>
                    {spanState?.loading ? (
                      <div className={styles.nestedState}>
                        <Spinner inline aria-label={`loading spans for ${generationID}`} />
                        <span>Loading spans...</span>
                      </div>
                    ) : spanState?.errorMessage ? (
                      <Alert severity="error" title="Failed to load spans">
                        {spanState.errorMessage}
                      </Alert>
                    ) : spanState && spanState.spans.length > 0 ? (
                      spanState.spans.map((span) => (
                        <div key={span.id} className={styles.spanRow}>
                          <Icon className={styles.spanIcon} name="circle" />
                          <div className={styles.spanName}>
                            <span>{span.name}</span>
                            <span className={styles.spanService}>({span.serviceName})</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className={styles.nestedState}>No spans found for this generation.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
