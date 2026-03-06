export type CursorPage<T> = {
  items: T[];
  next_cursor: string;
};

export async function fetchAllCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  maxPages = 1000
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const page = await fetchPage(cursor);
    items.push(...page.items);

    const nextCursor = page.next_cursor.trim();
    if (nextCursor === '') {
      return items;
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error(`pagination cursor repeated: ${nextCursor}`);
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
    pageCount += 1;
  }

  throw new Error(`pagination exceeded ${maxPages} pages`);
}
