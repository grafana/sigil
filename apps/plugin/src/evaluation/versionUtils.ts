/** Increments the patch segment of a semver-like version. e.g. "1.0.0" → "1.0.1", "2.1.3" → "2.1.4". */
export function nextPatchVersion(version: string): string {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return `${version}.1`;
  }
  const major = match[1];
  const minor = match[2] ?? '0';
  const patch = (parseInt(match[3] ?? '0', 10) + 1).toString();
  return `${major}.${minor}.${patch}`;
}

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
