import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, Stack, Text } from '@grafana/ui';
import { ROUTES } from '../constants';

export default function NotFoundPage() {
  return (
    <Stack direction="column" gap={2}>
      <Alert severity="warning" title="Page not found">
        <Text>The page you requested does not exist.</Text>
        <Text>
          <Link to={`/${ROUTES.Dashboard}`}>Go to Dashboard</Link>
        </Text>
      </Alert>
    </Stack>
  );
}
