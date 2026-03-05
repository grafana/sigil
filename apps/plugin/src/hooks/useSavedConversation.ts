import { useCallback, useEffect, useRef, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { SavedConversation } from '../evaluation/types';

/**
 * Manages the saved/unsaved state for a conversation via the eval saved-conversations API.
 *
 * On mount, attempts a deterministic ID fast-path GET (`saved-{conversationID}`) with error
 * alerts suppressed, then falls back to paginated list search for saves created by other UI
 * surfaces that may use a different saved_id scheme.
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

    // Try deterministic ID fast-path first (single GET, O(1)), then fall back to
    // paginated list search for saves created with a different saved_id scheme.
    const predictedId = `saved-${conversationID}`;
    void fastGetSavedConversation(predictedId)
      .then((saved) => {
        if (!stale && saved && saved.conversation_id === conversationID) {
          return saved.saved_id;
        }
        return paginateFind(evalDataSource, conversationID, () => stale);
      })
      .then((matchedSavedId) => {
        if (!stale) {
          setSavedId(matchedSavedId ?? null);
          setLoading(false);
        }
      });

    return () => {
      stale = true;
    };
  }, [conversationID, evalDataSource]);

  const toggleSave = useCallback(
    async (name?: string): Promise<ToggleSaveResult> => {
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
          name: name ?? conversationName ?? conversationID,
          saved_by: 'user',
        });
        setSavedId(result.saved_id);
        return true;
      } finally {
        savingRef.current = false;
      }
    },
    [isSaved, savedId, conversationID, conversationName, evalDataSource]
  );

  return { isSaved, loading, toggleSave };
}

const EVAL_BASE_PATH = '/api/plugins/grafana-sigil-app/resources/eval';

/**
 * Attempts a single GET for the predicted saved_id with error alerts suppressed.
 * Returns the saved conversation on success, or null on any failure (404, network, etc.).
 */
async function fastGetSavedConversation(savedID: string): Promise<SavedConversation | null> {
  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<SavedConversation>({
        method: 'GET',
        url: `${EVAL_BASE_PATH}/saved-conversations/${encodeURIComponent(savedID)}`,
        showErrorAlert: false,
      })
    );
    return response.data;
  } catch {
    return null;
  }
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
