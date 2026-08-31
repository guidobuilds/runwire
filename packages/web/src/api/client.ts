import type { AppType } from '@scout/server';
import { hc } from 'hono/client';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Minimal fetch used by tests; bun-types' `typeof fetch` also requires `preconnect`. */
export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createApiClient(fetchImpl: FetchImpl = fetch) {
  return hc<AppType>('', { fetch: fetchImpl as typeof fetch });
}

export const api = createApiClient();

export type ApiClient = ReturnType<typeof createApiClient>;

type Unwrapable = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

/**
 * Returns typed JSON for ok responses. On failure, throws ApiError with the
 * HTTP status and the body's `error` string when present.
 *
 * `T` is explicit because Hono `ClientResponse` unions (200 | 404) do not
 * narrow to one branch through a `json(): Promise<T>` parameter.
 */
export async function unwrap<T>(res: Unwrapable): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let message = res.statusText || 'request failed';
  try {
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
    ) {
      message = (body as { error: string }).error;
    }
  } catch {
    // Non-JSON error bodies still become ApiError with status + statusText.
  }
  throw new ApiError(res.status, message);
}
