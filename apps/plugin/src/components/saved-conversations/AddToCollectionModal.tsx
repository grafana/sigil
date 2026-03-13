import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Modal, MultiSelect, useStyles2 } from '@grafana/ui';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { Collection } from '../../evaluation/types';
import { CollectionFormModal } from './CollectionFormModal';

export type AddToCollectionModalProps = {
  isOpen: boolean;
  selectedSavedIDs: string[];
  collections: Collection[];
  dataSource: Pick<EvaluationDataSource, 'addCollectionMembers' | 'createCollection'>;
  onClose: () => void;
  onSaved: () => void;
  onCollectionCreated: (collection: Collection) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  subtitle: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(-1),
  }),
  createLink: css({
    color: theme.colors.primary.text,
    fontSize: theme.typography.bodySmall.fontSize,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left',
    '&:hover': { textDecoration: 'underline' },
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
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
  const [selectedCollectionIDs, setSelectedCollectionIDs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedCollectionIDs([]);
      setError(undefined);
    }
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const uniqueIDs = [...new Set(selectedSavedIDs)];
      await Promise.all(
        selectedCollectionIDs.map((colID) =>
          dataSource.addCollectionMembers(colID, { saved_ids: uniqueIDs, added_by: 'user' })
        )
      );
      onSaved();
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
      setSelectedCollectionIDs((prev) => [...prev, created.collection_id]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create collection');
    }
  };

  const options = collections.map((c) => ({ label: c.name, value: c.collection_id }));

  return (
    <>
      <Modal title="Add to collection" isOpen={isOpen} onDismiss={onClose}>
        <div className={styles.body}>
          <div className={styles.subtitle}>
            {selectedSavedIDs.length} conversation{selectedSavedIDs.length !== 1 ? 's' : ''} selected
          </div>
          {error && <Alert title={error} severity="error" />}
          <MultiSelect
            options={options}
            value={selectedCollectionIDs}
            onChange={(opts) => setSelectedCollectionIDs(opts.map((o) => o.value!))}
            placeholder="Search collections..."
            noOptionsMessage="No collections found"
          />
          <button className={styles.createLink} onClick={() => setShowCreateModal(true)}>
            + Create new collection
          </button>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || selectedCollectionIDs.length === 0}>
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
