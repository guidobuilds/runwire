// Same-origin fetch wrapper for the runwire HTTP API. Every URL is `/api/...`
// (api-prefix). Empty base URL: works unchanged under the dev proxy
// (vite.config.ts server.proxy forwards `/api` to @runwire/server) and under a
// future same-origin production hosting setup (plan.md decision #9).

/** Shape of every non-2xx JSON body returned by @runwire/server (createServer.ts). */
export type ApiErrorBody = {
  error: string;
  parameter?: string;
};

/** Thrown by `apiFetch` on any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly parameter?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = 'ApiError';
    this.status = status;
    this.error = body.error;
    this.parameter = body.parameter;
  }
}

/**
 * Fetches `path` (same-origin) and parses the JSON body as `T` on success.
 * On a non-2xx response, parses the body as `ApiErrorBody` and throws
 * `ApiError`. A body that isn't valid JSON (e.g. a proxy error page) falls
 * back to a generic error message rather than throwing a JSON parse error.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = { error: response.statusText || 'request failed' };
    }
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}
