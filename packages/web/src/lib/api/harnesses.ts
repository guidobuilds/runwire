import type { ApiHarnessOption } from '@scout/core';
import { apiFetch } from './client';

/** `GET /api/harnesses` — the harness options (id + display name) that have at
 * least one root session, one row per harness. */
export function fetchHarnesses(): Promise<ApiHarnessOption[]> {
  return apiFetch<ApiHarnessOption[]>('/api/harnesses');
}
