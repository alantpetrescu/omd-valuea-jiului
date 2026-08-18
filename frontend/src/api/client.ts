/**
 * The single place the frontend talks HTTP.
 *
 * Spec rule 3.4/6: components never call `fetch()` directly. Everything goes
 * component -> hook -> repository -> this client -> API, so error handling,
 * envelopes and the session cookie are handled once.
 */

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** Count ignoring filters, so lists can show "N din M". */
  totalUnfiltered?: number;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: PageMeta }> {
  let response: Response;

  try {
    // `...init` must come FIRST. Spreading it last let an explicitly passed
    // `headers: undefined` wipe out the computed headers, dropping
    // Content-Type so the server never parsed the JSON body.
    response = await fetch(`${BASE}${path}`, {
      ...init,
      // The session cookie is HttpOnly; the token is never readable from JS
      // and never stored in localStorage (spec 11.4).
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Serverul nu poate fi contactat. Verifică conexiunea.', 0);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      (error?.code as ApiErrorCode) ?? 'INTERNAL_ERROR',
      error?.message ?? 'A apărut o eroare neașteptată.',
      response.status,
      error?.details,
    );
  }

  return payload as { data: T; meta?: PageMeta };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
    }),
  /** `headers` carries If-Match for optimistic concurrency. */
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
    }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
