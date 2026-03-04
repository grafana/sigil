import type { SigilSpanTreeRow } from './adapter';

export function filterVisibleRows(rows: SigilSpanTreeRow[], childrenHiddenIDs: Set<string>): SigilSpanTreeRow[] {
  const visible: SigilSpanTreeRow[] = [];
  let collapseDepth: number | null = null;

  for (const row of rows) {
    if (collapseDepth != null) {
      if (row.depth > collapseDepth) {
        continue;
      }
      collapseDepth = null;
    }

    visible.push(row);

    if (row.hasChildren && childrenHiddenIDs.has(row.selectionID)) {
      collapseDepth = row.depth;
    }
  }

  return visible;
}

function isFullyCollapsed(rows: SigilSpanTreeRow[], childrenHiddenIDs: Set<string>): boolean {
  let parentCount = 0;
  for (const row of rows) {
    if (row.hasChildren) {
      parentCount += 1;
    }
  }
  return parentCount > 0 && parentCount === childrenHiddenIDs.size;
}

export function collapseAll(rows: SigilSpanTreeRow[]): Set<string> {
  const next = new Set<string>();
  for (const row of rows) {
    if (row.hasChildren) {
      next.add(row.selectionID);
    }
  }
  return next;
}

export function expandAll(): Set<string> {
  return new Set<string>();
}

export function expandOne(rows: SigilSpanTreeRow[], childrenHiddenIDs: Set<string>): Set<string> {
  if (childrenHiddenIDs.size === 0) {
    return childrenHiddenIDs;
  }

  let previousExpandedDepth = -1;
  let expandNextHiddenSpan = true;
  const next = new Set(childrenHiddenIDs);

  for (const row of rows) {
    if (row.depth <= previousExpandedDepth) {
      expandNextHiddenSpan = true;
    }
    if (expandNextHiddenSpan && next.has(row.selectionID)) {
      next.delete(row.selectionID);
      expandNextHiddenSpan = false;
      previousExpandedDepth = row.depth;
    }
  }

  return next;
}

export function collapseOne(rows: SigilSpanTreeRow[], childrenHiddenIDs: Set<string>): Set<string> {
  if (isFullyCollapsed(rows, childrenHiddenIDs)) {
    return childrenHiddenIDs;
  }

  let nearestExpandedParent: SigilSpanTreeRow | undefined;
  const next = new Set(childrenHiddenIDs);

  for (const row of rows) {
    if (nearestExpandedParent && row.depth <= nearestExpandedParent.depth) {
      next.add(nearestExpandedParent.selectionID);
      nearestExpandedParent = row.hasChildren && !next.has(row.selectionID) ? row : undefined;
      continue;
    }

    if (row.hasChildren && !next.has(row.selectionID)) {
      nearestExpandedParent = row;
    }
  }

  if (nearestExpandedParent) {
    next.add(nearestExpandedParent.selectionID);
  }

  return next;
}
