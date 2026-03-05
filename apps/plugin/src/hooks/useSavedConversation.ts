import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';

/**
 * Manages the saved/unsaved state for a conversation via the eval saved-conversations API.
 *
 * On mount, paginates through saved conversations to find one matching the conversation_id
 * (works regardless of the saved_id scheme used by different UI surfaces).
 *
 * When saving, uses `saved-{conversationID}` as the deterministic saved_id.
 */
export type ToggleSaveResult = boolean | null;

export function useSavedConversation(
  conversationID: string,
  conversationName?: string,
  evalDataSource: EvaluationDataSource = defaultEvaluationDataSource
) {
  const [savedId, setSavedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const savingRef = useRef(false);

  const isSaved = savedId !== null;

  useEffect(() => {
    if (!conversationID) {
      setLoading(false);
      return;
    }

    let stale = false;
    setLoading(true);

    // List saved conversations and find one matching this conversation_id.
    // This covers saves created by any UI surface regardless of saved_id scheme.
    void paginateFind(evalDataSource, conversationID, () => stale).then((matchedSavedId) => {
      if (!stale) {
        setSavedId(matchedSavedId);
        setLoading(false);
      }
    });

    return () => {
      stale = true;
    };
  }, [conversationID, evalDataSource]);

  const toggleSave = useCallback(async (): Promise<ToggleSaveResult> => {
    if (savingRef.current) {
      // A save/unsave request is already in flight; report explicit no-op.
      return null;
    }
    savingRef.current = true;
    try {
      if (isSaved && savedId) {
        await evalDataSource.deleteSavedConversation(savedId);
        setSavedId(null);
        return false;
      }
      const newSavedId = `saved-${conversationID}`;
      const result = await evalDataSource.saveConversation({
        saved_id: newSavedId,
        conversation_id: conversationID,
        name: conversationName ?? conversationID,
        saved_by: 'user',
      });
      setSavedId(result.saved_id);
      return true;
    } finally {
      savingRef.current = false;
    }
  }, [isSaved, savedId, conversationID, conversationName, evalDataSource]);

  return { isSaved, loading, toggleSave };
}

async function paginateFind(
  ds: EvaluationDataSource,
  conversationID: string,
  isStale: () => boolean
): Promise<string | null> {
  const PAGE_SIZE = 100;
  let cursor: string | undefined;
  try {
    do {
      const response = await ds.listSavedConversations(undefined, PAGE_SIZE, cursor);
      if (isStale()) {
        return null;
      }
      const match = response.items.find((item) => item.conversation_id === conversationID);
      if (match) {
        return match.saved_id;
      }
      cursor = response.next_cursor || undefined;
    } while (cursor);
  } catch {
    // Treat list failures as "not saved" — the user can still toggle manually.
  }
  return null;
}
