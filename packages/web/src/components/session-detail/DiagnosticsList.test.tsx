import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Diagnostic } from '../../api/types';
import { DiagnosticsList } from './DiagnosticsList';

const DIAGNOSTIC: Diagnostic = {
  level: 'warn',
  code: 'usage-total-mismatch',
  message: 'reported total disagrees with the sum of its parts',
  harness: 'fake',
  path: '/w/app/a.jsonl',
  line: 12,
  count: 3,
};

describe('DiagnosticsList', () => {
  afterEach(() => {
    cleanup();
  });

  test('a clean session shows neither the banner nor the table', () => {
    render(<DiagnosticsList diagnostics={[]} />);
    expect(screen.getByText('No diagnostics for this session.')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('a session with diagnostics shows the amber banner immediately, before any interaction', () => {
    render(<DiagnosticsList diagnostics={[DIAGNOSTIC]} />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('This session has data-quality diagnostics.');
    expect(screen.queryByText('No diagnostics for this session.')).toBeNull();
  });

  test('the banner is distinguishable by role and text, not merely by color', () => {
    const clean = render(<DiagnosticsList diagnostics={[]} />);
    expect(clean.container.querySelector('[role="status"]')).toBeNull();
    cleanup();
    const withDiagnostics = render(<DiagnosticsList diagnostics={[DIAGNOSTIC]} />);
    const banner = withDiagnostics.container.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent ?? '').toContain('1 entry below.');
  });

  test('the banner count pluralizes for more than one diagnostic', () => {
    render(<DiagnosticsList diagnostics={[DIAGNOSTIC, { ...DIAGNOSTIC, level: 'error' }]} />);
    expect(screen.getByRole('status').textContent).toContain('2 entries below.');
  });

  test('the table with full diagnostic detail still renders below the banner', () => {
    render(<DiagnosticsList diagnostics={[DIAGNOSTIC]} />);
    expect(screen.getByText('reported total disagrees with the sum of its parts')).not.toBeNull();
    expect(screen.getByText('/w/app/a.jsonl:12')).not.toBeNull();
    const row = screen.getByText('usage-total-mismatch').closest('tr');
    expect(row?.textContent).toContain('warn');
    expect(row?.textContent).toContain('3');
  });
});
