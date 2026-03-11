import React from 'react';
import { render, screen } from '@testing-library/react';
import VersionHistoryTable from './VersionHistoryTable';
import type { TemplateVersionSummary } from '../../evaluation/types';

describe('VersionHistoryTable', () => {
  it('shows updated actor metadata when versions include it', () => {
    const versions: TemplateVersionSummary[] = [
      {
        version: '2026-03-05',
        changelog: 'Refined rubric',
        created_by: 'alex@example.com',
        created_at: '2026-03-05T09:00:00Z',
        updated_by: 'morgan@example.com',
        updated_at: '2026-03-05T17:30:00Z',
      },
    ];

    render(<VersionHistoryTable versions={versions} selectedVersions={[]} onToggleSelect={() => {}} />);

    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('morgan@example.com')).toBeInTheDocument();
  });
});
