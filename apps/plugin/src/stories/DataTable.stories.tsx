import React from 'react';
import DataTable, { type ColumnDef } from '../components/shared/DataTable';

type SampleRow = {
  id: string;
  name: string;
  status: string;
  count: number;
  date: string;
};

const sampleData: SampleRow[] = [
  { id: '1', name: 'Alpha service', status: 'healthy', count: 1234, date: '2026-03-01' },
  { id: '2', name: 'Beta pipeline', status: 'error', count: 567, date: '2026-03-02' },
  { id: '3', name: 'Gamma endpoint', status: 'warning', count: 89, date: '2026-03-03' },
  { id: '4', name: 'Delta function', status: 'healthy', count: 4521, date: '2026-03-04' },
  { id: '5', name: 'Epsilon worker', status: 'healthy', count: 210, date: '2026-03-05' },
];

const columns: Array<ColumnDef<SampleRow>> = [
  { id: 'name', header: 'Name', cell: (row) => row.name },
  { id: 'status', header: 'Status', cell: (row) => row.status },
  { id: 'count', header: 'Count', cell: (row) => row.count.toLocaleString(), align: 'right' },
  { id: 'date', header: 'Date', cell: (row) => row.date },
];

const meta = {
  title: 'Sigil/DataTable',
  component: DataTable,
};

export default meta;

export const Default = {
  args: {
    columns,
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    onRowClick: (row: SampleRow) => console.log('Clicked:', row.id),
    rowRole: 'link',
  },
};

export const WithPanel = {
  args: {
    columns,
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    onRowClick: (row: SampleRow) => console.log('Clicked:', row.id),
    panelTitle: 'Recent items',
    seeMoreHref: '#see-more',
    seeMoreLabel: 'See all items',
  },
};

export const WithPanelSubtitle = {
  args: {
    columns,
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    panelTitle: 'Cache savings by model',
    panelSubtitle: '$12.34',
  },
};

export const Loading = {
  args: {
    columns,
    data: [],
    keyOf: (row: SampleRow) => row.id,
    panelTitle: 'Recent items',
    loading: true,
  },
};

export const Empty = {
  args: {
    columns,
    data: [],
    keyOf: (row: SampleRow) => row.id,
    panelTitle: 'Recent items',
    emptyIcon: 'search',
    emptyMessage: 'No items found in this time range.',
  },
};

export const ErrorState = {
  args: {
    columns,
    data: [],
    keyOf: (row: SampleRow) => row.id,
    panelTitle: 'Recent items',
    loadError: 'Failed to load items.',
  },
};

export const WithRowVariants = {
  args: {
    columns,
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    onRowClick: (row: SampleRow) => console.log('Clicked:', row.id),
    rowVariant: (row: SampleRow) => {
      if (row.status === 'error') {
        return 'error' as const;
      }
      if (row.status === 'warning') {
        return 'warning' as const;
      }
      return undefined;
    },
  },
};

export const WithSelection = {
  args: {
    columns,
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    onRowClick: (row: SampleRow) => console.log('Clicked:', row.id),
    isSelected: (row: SampleRow) => row.id === '2',
  },
};

export const StickyHeader = {
  render: () => (
    <div style={{ height: 200, overflow: 'auto' }}>
      <DataTable
        columns={columns}
        data={[...sampleData, ...sampleData, ...sampleData]}
        keyOf={(row: SampleRow) => row.id}
        onRowClick={(row: SampleRow) => console.log('Clicked:', row.id)}
        stickyHeader
      />
    </div>
  ),
};

export const NoHeader = {
  args: {
    columns: columns.slice(0, 2),
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    onRowClick: (row: SampleRow) => console.log('Clicked:', row.id),
    showHeader: false,
  },
};

export const WithLoadMore = {
  args: {
    columns,
    data: sampleData,
    keyOf: (row: SampleRow) => row.id,
    hasMore: true,
    loadingMore: false,
    onLoadMore: () => console.log('Load more'),
  },
};
