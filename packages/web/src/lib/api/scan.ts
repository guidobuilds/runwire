import type { ImportReport } from '@scout/core';
import { apiFetch } from './client';

/**
 * `POST /api/scan` — asks the server to run a full import and resolves with the
 * resulting `ImportReport`. The request is synchronous: the response arrives only
 * once every adapter has finished (or failed), so callers can show a loading state
 * for the whole scan.
 *
 * `X-Scout-Scan: 1` is the server's CSRF guard (SEC-02): a cross-site HTML form
 * cannot set a custom header, so this proves the request came from the UI.
 */
export function runScan(): Promise<ImportReport> {
  return apiFetch<ImportReport>('/api/scan', {
    method: 'POST',
    headers: { 'X-Scout-Scan': '1' },
  });
}
