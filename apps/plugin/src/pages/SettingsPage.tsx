import React from 'react';
import { Alert, Stack, Text } from '@grafana/ui';

export default function SettingsPage() {
  return (
    <Stack direction="column" gap={2}>
      <h2>Settings</h2>
      <Alert severity="info" title="Sigil bootstrap placeholder">
        <Text>Configuration UI is scaffolded. Service URL and ingestion settings will be managed from this page.</Text>
      </Alert>
    </Stack>
  );
}
