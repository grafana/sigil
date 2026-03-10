import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, LinkButton, Spinner, Text, useStyles2 } from '@grafana/ui';

export type ColumnDef<T> = {
  id: string;
  header: React.ReactNode;
  cell: (item: T) => React.ReactNode;
  width?: string | number;
  minWidth?: string | number;
  align?: 'left' | 'right' | 'center';
};

export type RowVariant = 'error' | 'warning' | 'info';

export type DataTableProps<T> = {
  columns: Array<ColumnDef<T>>;
  data: T[];
  keyOf: (item: T) => string;

  onRowClick?: (item: T, e: React.MouseEvent) => void;
  rowRole?: string;
  rowAriaLabel?: (item: T) => string;
  isSelected?: (item: T) => boolean;
  rowVariant?: (item: T) => RowVariant | undefined;

  stickyHeader?: boolean;
  showHeader?: boolean;
  scrollable?: boolean;
  fixedLayout?: boolean;
  minWidth?: number;
  className?: string;
  ariaLabel?: string;

  panel?: boolean;
  panelTitle?: string;
  panelSubtitle?: React.ReactNode;
  seeMoreHref?: string;
  seeMoreLabel?: string;

  loading?: boolean;
  loadError?: string;
  emptyIcon?: string;
  emptyMessage?: string;

  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export default function DataTable<T>(props: DataTableProps<T>) {
  const styles = useStyles2(getStyles);
  const {
    columns,
    data,
    keyOf,
    onRowClick,
    rowRole,
    rowAriaLabel,
    isSelected,
    rowVariant,
    stickyHeader = false,
    showHeader = true,
    scrollable = false,
    fixedLayout = false,
    minWidth,
    className,
    ariaLabel,
    panel = false,
    panelTitle,
    panelSubtitle,
    seeMoreHref,
    seeMoreLabel,
    loading = false,
    loadError,
    emptyIcon,
    emptyMessage,
    hasMore,
    loadingMore,
    onLoadMore,
  } = props;

  const hasData = !loading && !(loadError && data.length === 0) && data.length > 0;

  const tableEl = hasData ? (
    <table
      className={cx(styles.table, fixedLayout && styles.tableFixed, minWidth != null && css({ minWidth }))}
      aria-label={ariaLabel}
    >
      {columns.some((c) => c.width != null || c.minWidth != null) && (
        <colgroup>
          {columns.map((col) => (
            <col
              key={col.id}
              style={{
                ...(col.width != null ? { width: col.width } : undefined),
                ...(col.minWidth != null ? { minWidth: col.minWidth } : undefined),
              }}
            />
          ))}
        </colgroup>
      )}
      {showHeader && (
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                className={cx(
                  styles.headerCell,
                  stickyHeader && styles.headerCellSticky,
                  col.align === 'right' && styles.alignRight,
                  col.align === 'center' && styles.alignCenter
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {data.map((item) => {
          const variant = rowVariant?.(item);
          const selected = isSelected?.(item) ?? false;
          return (
            <tr
              key={keyOf(item)}
              className={cx(
                styles.row,
                onRowClick != null && styles.rowClickable,
                selected && styles.rowSelected,
                variant === 'error' && styles.rowError,
                variant === 'warning' && styles.rowWarning,
                variant === 'info' && styles.rowInfo
              )}
              data-variant={variant}
              onClick={onRowClick ? (e) => onRowClick(item, e) : undefined}
              role={rowRole}
              aria-label={rowAriaLabel?.(item)}
              aria-selected={isSelected ? selected : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.id}
                  className={cx(
                    styles.cell,
                    fixedLayout && styles.cellTruncate,
                    col.align === 'right' && styles.alignRight,
                    col.align === 'center' && styles.alignCenter
                  )}
                >
                  {col.cell(item)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  ) : null;

  const stateEl = loading ? (
    <div className={styles.emptyState}>
      <Spinner size="lg" />
    </div>
  ) : loadError && data.length === 0 ? (
    <div className={styles.emptyState}>
      <Text color="secondary">{loadError}</Text>
    </div>
  ) : data.length === 0 ? (
    <div className={styles.emptyState}>
      {emptyIcon && <Icon name={emptyIcon as React.ComponentProps<typeof Icon>['name']} size="xl" />}
      <Text color="secondary">{emptyMessage ?? 'No data found.'}</Text>
    </div>
  ) : null;

  const footerEl =
    hasData && seeMoreHref ? (
      <div className={styles.seeMoreFooter}>
        <LinkButton href={seeMoreHref} variant="secondary" fill="text" size="sm" icon="arrow-right">
          {seeMoreLabel ?? 'See more'}
        </LinkButton>
      </div>
    ) : null;

  const loadMoreEl =
    hasData && hasMore && onLoadMore ? (
      <Button aria-label="load more" onClick={onLoadMore} disabled={loadingMore} variant="secondary" fullWidth>
        {loadingMore ? 'Loading...' : 'Load more'}
      </Button>
    ) : null;

  const content = (
    <>
      {scrollable ? <div className={styles.scrollWrap}>{tableEl}</div> : tableEl}
      {stateEl}
      {footerEl}
      {loadMoreEl}
    </>
  );

  if (panelTitle != null) {
    return (
      <div className={cx(styles.tablePanel, className)}>
        <div className={styles.tablePanelHeader}>
          <span className={styles.panelTitle}>{panelTitle}</span>
          {panelSubtitle != null && <div className={styles.panelSubtitle}>{panelSubtitle}</div>}
        </div>
        {content}
      </div>
    );
  }

  if (panel) {
    return <div className={cx(styles.tablePanel, className)}>{content}</div>;
  }

  if (className) {
    return <div className={className}>{content}</div>;
  }

  return <>{content}</>;
}

export const getCommonCellStyles = (theme: GrafanaTheme2) => ({
  monoCell: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'normal' as const,
    overflowWrap: 'anywhere' as const,
  }),
});

const getStyles = (theme: GrafanaTheme2) => ({
  tablePanel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  tablePanelHeader: css({
    padding: theme.spacing(1.5, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  panelTitle: css({
    display: 'block',
    fontSize: theme.typography.h6.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  panelSubtitle: css({
    marginTop: theme.spacing(0.5),
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
  }),
  table: css({
    width: '100%',
    borderCollapse: 'separate' as const,
    borderSpacing: 0,
  }),
  tableFixed: css({
    tableLayout: 'fixed' as const,
  }),
  headerCell: css({
    padding: theme.spacing(1, 2),
    textAlign: 'left' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap' as const,
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
  }),
  headerCellSticky: css({
    position: 'sticky' as const,
    top: 0,
    zIndex: 2,
  }),
  row: css({
    transition: 'background 0.15s ease',
  }),
  rowClickable: css({
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    background: theme.colors.action.hover,
  }),
  rowError: css({
    '& td:first-child': {
      borderLeft: `2px solid ${theme.colors.error.main}`,
    },
  }),
  rowWarning: css({
    '& td:first-child': {
      borderLeft: `2px solid ${theme.colors.warning.main}`,
    },
  }),
  rowInfo: css({
    '& td:first-child': {
      borderLeft: `2px solid ${theme.colors.info.main}`,
    },
  }),
  cell: css({
    padding: theme.spacing(1, 2),
    fontSize: theme.typography.bodySmall.fontSize,
    verticalAlign: 'middle' as const,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  cellTruncate: css({
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
  }),
  alignRight: css({
    textAlign: 'right' as const,
  }),
  alignCenter: css({
    textAlign: 'center' as const,
  }),
  emptyState: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
  }),
  seeMoreFooter: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  scrollWrap: css({
    overflowX: 'auto' as const,
  }),
});
