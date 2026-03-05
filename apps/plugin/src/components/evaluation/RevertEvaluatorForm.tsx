import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Field, Input, Stack, useStyles2 } from '@grafana/ui';
import type { CreateEvaluatorRequest, Evaluator } from '../../evaluation/types';
import { nextVersion } from '../../evaluation/versionUtils';
import { getSectionTitleStyles } from './sectionStyles';

export type RevertEvaluatorFormProps = {
  evaluator: Evaluator;
  /** All existing versions; used to suggest a unique next version. */
  existingVersions?: string[];
  onSubmit: (req: CreateEvaluatorRequest) => void;
  onCancel: () => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    background: theme.colors.background.primary,
    flexShrink: 0,
    padding: theme.spacing(0.75, 1.25, 0.25),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  sectionTitle: css({
    ...getSectionTitleStyles(theme),
  }),
  sectionBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.25),
  }),
});

export default function RevertEvaluatorForm({
  evaluator,
  existingVersions,
  onSubmit,
  onCancel,
}: RevertEvaluatorFormProps) {
  const styles = useStyles2(getStyles);
  const [version] = useState(() => nextVersion(existingVersions));

  const handleSubmit = () => {
    const req: CreateEvaluatorRequest = {
      evaluator_id: evaluator.evaluator_id,
      version: version.trim(),
      kind: evaluator.kind,
      config: evaluator.config ?? {},
      output_keys: evaluator.output_keys ?? [],
    };
    onSubmit(req);
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Revert to version {evaluator.version}</div>
      </div>
      <div className={styles.sectionBody}>
        <Field label="New version" description="This will create a new version with the same configuration.">
          <Input value={version} readOnly disabled width={20} />
        </Field>

        <Stack direction="row" gap={1}>
          <Button onClick={handleSubmit}>Revert</Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </Stack>
      </div>
    </div>
  );
}
