import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Input, Spinner, Text, useStyles2 } from '@grafana/ui';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../../conversation/api';
import type { ConversationDetail } from '../../conversation/types';
import type { GenerationDetail } from '../../generation/types';

export type GenerationPickerProps = {
  onSelect: (generationId: string | undefined) => void;
  selectedGenerationId?: string;
  conversationsDataSource?: ConversationsDataSource;
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
});

type ConversationRow = {
  conversation_id: string;
  generation_count: number;
  last_generation_at: string;
  models?: string[];
};

export default function GenerationPicker({
  onSelect,
  selectedGenerationId,
  conversationsDataSource,
}: GenerationPickerProps) {
  const styles = useStyles2(getStyles);
  const convDs = conversationsDataSource ?? defaultConversationsDataSource;
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
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

  const handleGenerationSelect = (genId: string) => {
    onSelect(genId);
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
                onClick={() => handleGenerationSelect(gen.generation_id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerationSelect(gen.generation_id)}
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
      <div className={styles.stepHeader}>
        <Text variant="bodySmall" weight="medium">
          Pick a conversation
        </Text>
        <Text variant="bodySmall" color="secondary">
          (recent)
        </Text>
      </div>
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
    </div>
  );
}
