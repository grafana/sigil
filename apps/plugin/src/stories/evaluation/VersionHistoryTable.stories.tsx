import React, { useState } from 'react';
import VersionHistoryTable from '../../components/evaluation/VersionHistoryTable';
import type { TemplateVersionSummary } from '../../evaluation/types';

const versions: TemplateVersionSummary[] = [
  {
    version: '2026-03-05',
    changelog: 'Tightened prompt wording and lowered temperature.',
    created_by: 'alex@example.com',
    created_at: '2026-03-05T14:30:00Z',
    updated_by: 'alex@example.com',
    updated_at: '2026-03-05T14:30:00Z',
  },
  {
    version: '2026-03-04',
    changelog: 'Added explicit output description for the score key.',
    created_by: 'morgan@example.com',
    created_at: '2026-03-04T11:10:00Z',
    updated_by: 'taylor@example.com',
    updated_at: '2026-03-04T16:45:00Z',
  },
  {
    version: '2026-03-02',
    changelog: '',
    created_by: '—',
    created_at: '2026-03-02T09:00:00Z',
  },
];

function VersionHistoryTableStory() {
  const [selectedVersions, setSelectedVersions] = useState<string[]>(['2026-03-05']);

  const handleToggleSelect = (version: string) => {
    setSelectedVersions((current) => {
      if (current.includes(version)) {
        return current.filter((item) => item !== version);
      }
      return current.length >= 2 ? current : [...current, version];
    });
  };

  return (
    <VersionHistoryTable
      versions={versions}
      selectedVersions={selectedVersions}
      onToggleSelect={handleToggleSelect}
      onRollback={() => {}}
    />
  );
}

const meta = {
  title: 'Sigil/Evaluation/VersionHistoryTable',
  component: VersionHistoryTable,
};

export default meta;

export const Default = {
  render: () => <VersionHistoryTableStory />,
};

export const Empty = {
  render: () => (
    <VersionHistoryTable versions={[]} selectedVersions={[]} onToggleSelect={() => {}} onRollback={() => {}} />
  ),
};
