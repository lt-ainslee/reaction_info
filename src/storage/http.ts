// JSON requests to this app's own API (/api/*, worker/).

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> | null,
  ) {
    // The server's error code ("cycle", "abbr_taken"…) when it sent one.
    super(typeof body?.error === 'string' ? body.error : `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/**
 * Fetch `path` and parse the JSON reply (undefined for 204). A string body is
 * sent as JSON; anything else (FormData, Blob) as is. Throws HttpError when
 * the status is not 2xx.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const json = typeof init?.body === 'string';
  const res = await fetch(path, {
    ...init,
    headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, body);
  return body as T;
}

export const isStatus = (e: unknown, status: number) => e instanceof HttpError && e.status === status;
