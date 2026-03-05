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
    <FieldSet label={`Revert to version ${evaluator.version}`}>
      <Field label="New version" description="This will create a new version with the same configuration.">
        <Input value={version} readOnly disabled width={20} />
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
