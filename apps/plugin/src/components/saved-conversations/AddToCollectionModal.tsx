import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Input, Modal, useStyles2 } from '@grafana/ui';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { Collection } from '../../evaluation/types';
import { CollectionFormModal } from './CollectionFormModal';

export type AddToCollectionModalProps = {
  isOpen: boolean;
  selectedSavedIDs: string[];
  collections: Collection[];
  dataSource: Pick<EvaluationDataSource,
    'listCollectionsForSavedConversation' | 'addCollectionMembers' | 'removeCollectionMember' | 'createCollection'
  >;
  onClose: () => void;
  onSaved: () => void;
  onCollectionCreated: (collection: Collection) => void;
};

// checked = all selected in collection, partial = some, unchecked = none
type CheckState = 'checked' | 'partial' | 'unchecked';

const getStyles = (theme: GrafanaTheme2) => ({
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  subtitle: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(-1),
  }),
  filterInput: css({ width: '100%' }),
  list: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    maxHeight: 280,
    overflowY: 'auto',
  }),
  item: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  itemLabel: css({ flex: 1, fontSize: theme.typography.body.fontSize }),
  itemCount: css({ fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary }),
  partialNote: css({ fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary, fontStyle: 'italic' }),
  createLink: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(1),
    color: theme.colors.primary.text,
    fontSize: theme.typography.body.fontSize,
    background: 'none',
    border: 'none',
    textAlign: 'left',
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    '&:hover': { textDecoration: 'underline' },
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.5),
  }),
});

export function AddToCollectionModal({
  isOpen,
  selectedSavedIDs,
  collections,
  dataSource,
  onClose,
  onSaved,
  onCollectionCreated,
}: AddToCollectionModalProps) {
  const styles = useStyles2(getStyles);

  // Map: collectionID -> Set of selectedSavedIDs already in it
  const [membershipMap, setMembershipMap] = useState<Map<string, Set<string>>>(new Map());
  const [checkStates, setCheckStates] = useState<Map<string, CheckState>>(new Map());
  const [filterQuery, setFilterQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Load membership on open
  useEffect(() => {
    if (!isOpen || selectedSavedIDs.length === 0) return;

    const BATCH = 20;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(undefined);
      const result = new Map<string, Set<string>>();
      collections.forEach((c) => result.set(c.collection_id, new Set()));

      try {
        for (let i = 0; i < selectedSavedIDs.length; i += BATCH) {
          if (cancelled) return;
          const batch = selectedSavedIDs.slice(i, i + BATCH);
          // Note: listCollectionsForSavedConversation has no cursor parameter in the
          // current API, so only the first page of memberships is fetched per conversation.
          // This is a known API limitation.
          const responses = await Promise.all(
            batch.map((id) => dataSource.listCollectionsForSavedConversation(id))
          );
          responses.forEach((resp, idx) => {
            const savedID = batch[idx];
            resp.items.forEach((col) => {
              result.get(col.collection_id)?.add(savedID);
            });
          });
        }
        if (cancelled) return;

        setMembershipMap(result);
        const states = new Map<string, CheckState>();
        result.forEach((members, colID) => {
          if (members.size === 0) states.set(colID, 'unchecked');
          else if (members.size === selectedSavedIDs.length) states.set(colID, 'checked');
          else states.set(colID, 'partial');
        });
        setCheckStates(states);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load memberships');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [isOpen, selectedSavedIDs, collections, dataSource]);

  const toggleCheck = (colID: string) => {
    setCheckStates((prev) => {
      const next = new Map(prev);
      const cur = prev.get(colID) ?? 'unchecked';
      next.set(colID, cur === 'checked' ? 'unchecked' : 'checked');
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    try {
      for (const [colID, state] of checkStates) {
        const current = membershipMap.get(colID) ?? new Set<string>();

        if (state === 'checked') {
          // Add conversations not already in this collection
          const toAdd = selectedSavedIDs.filter((id) => !current.has(id));
          if (toAdd.length > 0) {
            await dataSource.addCollectionMembers(colID, { saved_ids: toAdd, added_by: 'user' });
          }
        } else if (state === 'unchecked') {
          // Remove conversations that were in this collection
          const toRemove = selectedSavedIDs.filter((id) => current.has(id));
          await Promise.all(
            toRemove.map((id) => dataSource.removeCollectionMember(colID, id))
          );
        }
        // partial -> partial: no-op (user didn't change it)
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCollection = async (values: { name: string; description?: string }) => {
    try {
      const created = await dataSource.createCollection({
        name: values.name,
        description: values.description,
        created_by: 'user',
      });
      onCollectionCreated(created);
      setShowCreateModal(false);
      // Pre-check the newly created collection
      setCheckStates((prev) => new Map(prev).set(created.collection_id, 'checked'));
      setMembershipMap((prev) => new Map(prev).set(created.collection_id, new Set()));
    } catch (e) {
      // Surface error in the main modal, not just in CollectionFormModal
      setError(e instanceof Error ? e.message : 'Failed to create collection');
      setShowCreateModal(false);
    }
  };

  const hasChanges = [...checkStates.entries()].some(([colID, state]) => {
    const current = membershipMap.get(colID) ?? new Set<string>();
    if (state === 'checked') {
      return selectedSavedIDs.some((id) => !current.has(id));
    }
    if (state === 'unchecked') {
      return selectedSavedIDs.some((id) => current.has(id));
    }
    return false;
  });

  const filtered = filterQuery
    ? collections.filter((c) => c.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : collections;

  return (
    <>
      <Modal title="Add to collection" isOpen={isOpen} onDismiss={onClose}>
        <div className={styles.body}>
          <div className={styles.subtitle}>
            {selectedSavedIDs.length} conversation{selectedSavedIDs.length !== 1 ? 's' : ''} selected
          </div>
          {error && <Alert title={error} severity="error" />}
          <Input
            className={styles.filterInput}
            placeholder="Filter collections..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.currentTarget.value)}
          />
          <div className={styles.list}>
            {loading ? (
              <span>Loading...</span>
            ) : (
              filtered.map((col) => {
                const state = checkStates.get(col.collection_id) ?? 'unchecked';
                const isChecked = state === 'checked';
                const isPartial = state === 'partial';
                return (
                  <div key={col.collection_id} className={styles.item} onClick={() => toggleCheck(col.collection_id)}>
                    <input
                      type="checkbox"
                      aria-label={col.name}
                      checked={isChecked}
                      ref={(el) => { if (el) el.indeterminate = isPartial; }}
                      onChange={() => {}}
                      onClick={(e) => { e.stopPropagation(); toggleCheck(col.collection_id); }}
                    />
                    <span className={styles.itemLabel}>{col.name}</span>
                    <span className={styles.itemCount}>{col.member_count}</span>
                    {isPartial && <span className={styles.partialNote}>partial</span>}
                  </div>
                );
              })
            )}
          </div>
          <button className={styles.createLink} onClick={() => setShowCreateModal(true)}>
            + Create new collection
          </button>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || loading || !hasChanges}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
      <CollectionFormModal
        isOpen={showCreateModal}
        onSubmit={handleCreateCollection}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  );
}
