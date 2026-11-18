import type { ImportReport } from '@runwire/core';
import { apiFetch } from './client';

export function runScan(): Promise<ImportReport> {
  return apiFetch<ImportReport>('/api/scan', {
    method: 'POST',
    headers: { 'X-Runwire-Scan': '1' },
  });
}
