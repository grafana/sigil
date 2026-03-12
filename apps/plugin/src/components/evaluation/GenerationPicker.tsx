import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Input, Select, Spinner, Text, useStyles2 } from '@grafana/ui';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../../conversation/api';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import type { ConversationDetail, GenerationLookupHints } from '../../conversation/types';
import type { GenerationDetail } from '../../generation/types';
import type { Collection, SavedConversation } from '../../evaluation/types';

export type GenerationPickerProps = {
  onSelect: (generationId: string | undefined, hints?: GenerationLookupHints) => void;
  selectedGenerationId?: string;
  conversationsDataSource?: ConversationsDataSource;
  evaluationDataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    background: theme.colors.background.canvas,
  }),
  stepHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  searchBox: css({
    padding: theme.spacing(1),
  }),
  list: css({
    maxHeight: 240,
    overflowY: 'auto' as const,
  }),
  row: css({
    display: 'flex',
    flexDirection: 'column' as const,
    padding: theme.spacing(1, 1.5),
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:hover': {
      background: theme.colors.action.hover,
    },
    '&:last-child': {
      borderBottom: 'none',
    },
  }),
  selectedRow: css({
    display: 'flex',
    flexDirection: 'column' as const,
    padding: theme.spacing(1, 1.5),
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.primary.transparent,
    '&:last-child': {
      borderBottom: 'none',
    },
  }),
  empty: css({
    padding: theme.spacing(2),
    textAlign: 'center' as const,
  }),
  selectedBanner: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    background: theme.colors.success.transparent,
    border: `1px solid ${theme.colors.success.border}`,
    borderRadius: theme.shape.radius.default,
  }),
  tabBar: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  tabButton: css({
    padding: theme.spacing(0.5, 1),
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  tabButtonActive: css({
    padding: theme.spacing(0.5, 1),
    border: 'none',
    background: theme.colors.action.selected,
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  sourceBadge: css({
    display: 'inline-block',
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
  }),
});

type ConversationRow = {
  conversation_id: string;
  generation_count: number;
  last_generation_at: string;
  models?: string[];
};

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function sortSavedConversationsNewestFirst(conversations: SavedConversation[]): SavedConversation[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((left, right) => {
      const timestampDiff = toTimestamp(right.conversation.created_at) - toTimestamp(left.conversation.created_at);
      if (timestampDiff !== 0 && !Number.isNaN(timestampDiff)) {
        return timestampDiff;
      }
      return left.index - right.index;
    })
    .map(({ conversation }) => conversation);
}

export default function GenerationPicker({
  onSelect,
  selectedGenerationId,
  conversationsDataSource,
  evaluationDataSource,
}: GenerationPickerProps) {
  const styles = useStyles2(getStyles);
  const convDs = conversationsDataSource ?? defaultConversationsDataSource;
  const evalDs = evaluationDataSource ?? defaultEvaluationDataSource;
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [tab, setTab] = useState<'saved' | 'recent'>('saved');
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(undefined);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await convDs.listConversations?.();
      setConversations(
        (res?.items ?? []).slice(0, 10).map((item) => ({
          conversation_id: item.id,
          generation_count: item.generation_count,
          last_generation_at: item.last_generation_at,
        }))
      );
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [convDs]);

  // Load recent conversations on mount
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Debounced search when user types a filter; clear reloads the list
  useEffect(() => {
    if (query === '') {
      void loadList();
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const result = await convDs.searchConversations({
          filters: query,
          select: [],
          time_range: { from: weekAgo.toISOString(), to: now.toISOString() },
          page_size: 10,
        });
        setConversations(
          (result.conversations ?? []).map((c) => ({
            conversation_id: c.conversation_id,
            generation_count: c.generation_count,
            last_generation_at: c.last_generation_at,
            models: c.models,
          }))
        );
      } catch {
        setConversations([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, loadList, convDs]);

  // Load saved conversations when the saved tab is active
  useEffect(() => {
    if (tab !== 'saved') {
      return;
    }
    let cancelled = false;
    setLoadingSaved(true);

    const load = selectedCollectionId
      ? (evalDs.listCollectionMembers?.(selectedCollectionId, 50) ?? Promise.resolve({ items: [], next_cursor: '' }))
      : evalDs.listSavedConversations(undefined, 50);

    load
      .then((resp) => {
        if (!cancelled) {
          // Client-side ordering only applies to the first fetched page (50 items).
          setSavedConversations(sortSavedConversationsNewestFirst(resp.items ?? []));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedConversations([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSaved(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, evalDs, selectedCollectionId]);

  // Load collections when saved tab is active
  useEffect(() => {
    if (tab !== 'saved') {
      return;
    }
    let cancelled = false;
    (evalDs.listCollections?.(100) ?? Promise.resolve({ items: [], next_cursor: '' }))
      .then((resp) => {
        if (!cancelled) {
          setCollections(resp.items ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCollections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, evalDs]);

  const handleConversationClick = async (conversationId: string) => {
    setLoadingDetail(true);
    try {
      const d = await convDs.getConversationDetail(conversationId);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleGenerationSelect = (generation: GenerationDetail) => {
    const hints: GenerationLookupHints | undefined =
      detail == null
        ? undefined
        : {
            conversation_id: detail.conversation_id,
            from: detail.first_generation_at,
            to: detail.last_generation_at,
            at: generation.created_at,
          };
    onSelect(generation.generation_id, hints);
    setConfirmed(true);
  };

  const handleChange = () => {
    onSelect(undefined);
    setConfirmed(false);
    setDetail(null);
  };

  // Compact view once a generation is selected and confirmed
  if (confirmed && selectedGenerationId) {
    return (
      <div className={styles.selectedBanner}>
        <span>
          <Icon name="check-circle" />{' '}
          <Text variant="bodySmall" weight="medium">
            {selectedGenerationId}
          </Text>
        </span>
        <Button variant="secondary" size="sm" onClick={handleChange}>
          Change
        </Button>
      </div>
    );
  }

  // Step 2: Pick a generation from the selected conversation
  if (detail) {
    return (
      <div className={styles.container}>
        <div className={styles.stepHeader}>
          <Button variant="secondary" size="sm" icon="arrow-left" aria-label="Back" onClick={() => setDetail(null)} />
          <Text variant="bodySmall" weight="medium">
            Pick a generation
          </Text>
          <Text variant="bodySmall" color="secondary">
            &mdash; {detail.conversation_id.slice(0, 12)}&hellip;
          </Text>
        </div>
        <div className={styles.list}>
          {loadingDetail && (
            <div className={styles.empty}>
              <Spinner />
            </div>
          )}
          {[...(detail.generations ?? [])]
            .sort((a, b) => {
              const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
              const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
              return tb - ta;
            })
            .map((gen: GenerationDetail) => (
              <div
                key={gen.generation_id}
                className={gen.generation_id === selectedGenerationId ? styles.selectedRow : styles.row}
                onClick={() => handleGenerationSelect(gen)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerationSelect(gen)}
              >
                <Text variant="bodySmall" weight="medium" truncate>
                  {gen.generation_id}
                </Text>
                <Text variant="bodySmall" color="secondary">
                  {gen.model?.name ?? '\u2014'} &middot;{' '}
                  {gen.created_at ? new Date(gen.created_at).toLocaleString() : '\u2014'}
                </Text>
              </div>
            ))}
          {!loadingDetail && (detail.generations ?? []).length === 0 && (
            <div className={styles.empty}>
              <Text variant="bodySmall" color="secondary">
                No generations in this conversation.
              </Text>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Step 1: Pick a conversation
  return (
    <div className={styles.container}>
      <div className={styles.tabBar}>
        <button className={tab === 'saved' ? styles.tabButtonActive : styles.tabButton} onClick={() => setTab('saved')}>
          Saved
        </button>
        <button
          className={tab === 'recent' ? styles.tabButtonActive : styles.tabButton}
          onClick={() => setTab('recent')}
        >
          Recent
        </button>
      </div>

      {tab === 'saved' && (
        <>
          {collections.length > 0 && (
            <div className={styles.searchBox}>
              <Select
                options={collections.map((c) => ({
                  label: `${c.name} (${c.member_count})`,
                  value: c.collection_id,
                }))}
                value={selectedCollectionId ?? null}
                onChange={(v) => setSelectedCollectionId(v?.value)}
                placeholder="All saved conversations"
                isClearable
              />
            </div>
          )}
          <div className={styles.list}>
            {loadingSaved && (
              <div className={styles.empty}>
                <Spinner />
              </div>
            )}
            {!loadingSaved &&
              savedConversations.map((sc) => (
                <div
                  key={sc.saved_id}
                  className={styles.row}
                  onClick={() => handleConversationClick(sc.conversation_id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleConversationClick(sc.conversation_id)}
                >
                  <Text variant="bodySmall" weight="medium" truncate>
                    {sc.name}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    <span className={styles.sourceBadge}>{sc.source}</span> &middot; {sc.saved_by} &middot;{' '}
                    {sc.created_at ? new Date(sc.created_at).toLocaleString() : '\u2014'}
                  </Text>
                </div>
              ))}
            {!loadingSaved && savedConversations.length === 0 && (
              <div className={styles.empty}>
                <Text variant="bodySmall" color="secondary">
                  {selectedCollectionId ? 'No conversations in this collection.' : 'No saved conversations.'}
                </Text>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'recent' && (
        <>
          <div className={styles.searchBox}>
            <Input
              placeholder="Filter by conversation ID, model, or agent..."
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              prefix={loading ? <Spinner inline /> : undefined}
            />
          </div>
          <div className={styles.list}>
            {conversations.map((conv) => (
              <div
                key={conv.conversation_id}
                className={styles.row}
                onClick={() => handleConversationClick(conv.conversation_id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleConversationClick(conv.conversation_id)}
              >
                <Text variant="bodySmall" weight="medium" truncate>
                  {conv.conversation_id}
                </Text>
                <Text variant="bodySmall" color="secondary">
                  {`${conv.generation_count} generations`} &middot; {conv.models?.join(', ') || '\u2014'} &middot;{' '}
                  {conv.last_generation_at ? new Date(conv.last_generation_at).toLocaleString() : '\u2014'}
                </Text>
              </div>
            ))}
            {!loading && conversations.length === 0 && (
              <div className={styles.empty}>
                <Text variant="bodySmall" color="secondary">
                  No conversations found.
                </Text>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
