import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';

/**
 * Manages the saved/unsaved state for a conversation via the eval saved-conversations API.
 *
 * ID convention: this hook uses `saved-{conversationID}` as the deterministic saved_id when
 * creating new saves. The initial lookup tries this predicted ID first (fast path), then falls
 * back to paginating the full saved-conversations list to find entries created by other UI
 * surfaces (e.g. GenerationPicker) that may use different ID schemes.
 */
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

    // Fast path: try the deterministic ID this hook would generate.
    const predictedId = `saved-${conversationID}`;
    evalDataSource
      .getSavedConversation(predictedId)
      .then((saved) => {
        if (!stale) {
          setSavedId(saved.saved_id);
          setLoading(false);
        }
      })
      .catch(() => {
        if (stale) {
          return;
        }
        // Slow path: paginate through all saved conversations to find one matching
        // this conversation_id (covers saves created with non-deterministic IDs).
        void paginateFind(evalDataSource, conversationID, () => stale).then((matchedSavedId) => {
          if (!stale) {
            setSavedId(matchedSavedId);
            setLoading(false);
          }
        });
      });

    return () => {
      stale = true;
    };
  }, [conversationID, evalDataSource]);

  const toggleSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      return isSaved;
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
