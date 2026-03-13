import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Input, Modal, TextArea, useStyles2 } from '@grafana/ui';

export type CollectionFormValues = {
  name: string;
  description?: string;
};

export type CollectionFormModalProps = {
  isOpen: boolean;
  onSubmit: (values: CollectionFormValues) => Promise<void>;
  onClose: () => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  field: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  label: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  required: css({
    color: theme.colors.error.text,
    marginLeft: theme.spacing(0.5),
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),
});

export function CollectionFormModal({ isOpen, onSubmit, onClose }: CollectionFormModalProps) {
  const styles = useStyles2(getStyles);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleClose = () => {
    setName('');
    setDescription('');
    setError(undefined);
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create collection');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New collection" isOpen={isOpen} onDismiss={handleClose}>
      <div className={styles.body}>
        {error && <Alert title={error} severity="error" />}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="collection-name">
            Name<span className={styles.required}>*</span>
          </label>
          <Input
            id="collection-name"
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={255}
            placeholder="Collection name"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="collection-desc">
            Description <span style={{ color: 'inherit', opacity: 0.5 }}>(optional)</span>
          </label>
          <TextArea
            id="collection-desc"
            aria-label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="Add a description..."
            rows={3}
          />
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || name.trim() === ''}>
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
