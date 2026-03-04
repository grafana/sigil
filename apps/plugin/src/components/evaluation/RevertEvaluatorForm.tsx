import React, { useState } from 'react';
import { Button, Field, FieldSet, Input, Stack } from '@grafana/ui';
import type { CreateEvaluatorRequest, Evaluator } from '../../evaluation/types';
import { nextVersion } from '../../evaluation/versionUtils';

export type RevertEvaluatorFormProps = {
  evaluator: Evaluator;
  /** All existing versions; used to suggest a unique next version. */
  existingVersions?: string[];
  onSubmit: (req: CreateEvaluatorRequest) => void;
  onCancel: () => void;
};

export default function RevertEvaluatorForm({
  evaluator,
  existingVersions,
  onSubmit,
  onCancel,
}: RevertEvaluatorFormProps) {
  const [version, setVersion] = useState(() => nextVersion(existingVersions));
  const [touched, setTouched] = useState(false);

  const isVersionEmpty = version.trim() === '';
  const showVersionError = touched && isVersionEmpty;

  const handleSubmit = () => {
    setTouched(true);
    if (isVersionEmpty) {
      return;
    }

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
    <FieldSet label={`Revert to version ${evaluator.version}`}>
      <Field
        label="New version"
        description="This will create a new version with the same configuration."
        required
        invalid={showVersionError}
        error={showVersionError ? 'Version is required' : undefined}
      >
        <Input
          value={version}
          onChange={(e) => setVersion(e.currentTarget.value)}
          placeholder="YYYY-MM-DD"
          width={20}
        />
      </Field>

      <Stack direction="row" gap={1}>
        <Button onClick={handleSubmit}>Revert</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </FieldSet>
  );
}
