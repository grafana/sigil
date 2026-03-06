export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const withStatus = err as {
    status?: unknown;
    statusCode?: unknown;
    data?: { status?: unknown; statusCode?: unknown; message?: unknown };
    message?: unknown;
  };
  if (withStatus.status === 404 || withStatus.statusCode === 404) {
    return true;
  }
  if (withStatus.data?.status === 404 || withStatus.data?.statusCode === 404) {
    return true;
  }
  const message = typeof withStatus.message === 'string' ? withStatus.message : '';
  const dataMessage = typeof withStatus.data?.message === 'string' ? withStatus.data.message : '';
  return /\b404\b/.test(message) || /\b404\b/.test(dataMessage);
}
