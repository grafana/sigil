/** Suggests next version string in YYYY-MM-DD or YYYY-MM-DD.N format. */
export function nextVersion(existingVersions?: string[]): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const base = `${yyyy}-${mm}-${dd}`;

  if (!existingVersions?.length) {
    return base;
  }

  const existing = new Set(existingVersions);
  if (!existing.has(base)) {
    return base;
  }

  for (let n = 1; n < 100; n++) {
    const candidate = `${base}.${n}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base}.100`;
}
