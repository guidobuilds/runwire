import type { ImportReport } from '@scout/core';
import { apiFetch } from './client';

/**
 * `POST /api/scan` — asks the server to run a full import and resolves with the
 * resulting `ImportReport`. The request is synchronous: the response arrives only
 * once every adapter has finished (or failed), so callers can show a loading state
 * for the whole scan.
 */
export function runScan(): Promise<ImportReport> {
  return apiFetch<ImportReport>('/api/scan', { method: 'POST' });
}
