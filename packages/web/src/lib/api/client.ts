export type ApiErrorBody = {
  error: string;
  parameter?: string;
};

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
