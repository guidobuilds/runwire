import type { ApiHarnessOption } from '@runwire/core';
import { apiFetch } from './client';

export function fetchHarnesses(): Promise<ApiHarnessOption[]> {
  return apiFetch<ApiHarnessOption[]>('/api/harnesses');
}
