import { fetchAllCursorPages } from './pagination';

describe('fetchAllCursorPages', () => {
  it('accumulates all cursor pages in order', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], next_cursor: 'a' })
      .mockResolvedValueOnce({ items: [3], next_cursor: 'b' })
      .mockResolvedValueOnce({ items: [4, 5], next_cursor: '' });

    await expect(fetchAllCursorPages(fetchPage)).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage.mock.calls).toEqual([[undefined], ['a'], ['b']]);
  });

  it('fails if the backend repeats a cursor', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: [1], next_cursor: 'dup' })
      .mockResolvedValueOnce({ items: [2], next_cursor: 'dup' });

    await expect(fetchAllCursorPages(fetchPage)).rejects.toThrow('pagination cursor repeated: dup');
  });
});
