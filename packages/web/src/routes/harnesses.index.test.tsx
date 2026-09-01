import { describe, expect, test } from 'vitest';
import type { HarnessAggregate, StatusResponse } from '../api/types';
import { mergeInstalledHarnesses } from './harnesses.index';

function adapter(
  overrides: Partial<StatusResponse['adapters'][number]> = {},
): StatusResponse['adapters'][number] {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    capabilities: [],
    probe: { installed: true, roots: [], notes: [] },
    ...overrides,
  };
}

const WITH_SESSIONS: HarnessAggregate = {
  harness: 'claude-code',
  sessionCount: 12,
  projects: ['github.com/org/alpha'],
  aggregateUsage: {},
};

describe('mergeInstalledHarnesses', () => {
  test('leaves an aggregate that already has sessions unchanged', () => {
    const merged = mergeInstalledHarnesses([WITH_SESSIONS], [adapter()]);
    expect(merged).toEqual([WITH_SESSIONS]);
    expect(merged[0]?.emptyVariant).toBeUndefined();
  });

  test('adds a zero-session placeholder for an installed adapter with no aggregate at all', () => {
    const merged = mergeInstalledHarnesses(
      [],
      [
        adapter({
          id: 'codex',
          displayName: 'Codex',
          probe: { installed: true, roots: [], notes: [] },
        }),
      ],
    );
    expect(merged).toEqual([
      {
        harness: 'codex',
        sessionCount: 0,
        projects: [],
        aggregateUsage: {},
        emptyVariant: 'installed-no-sessions',
      },
    ]);
  });

  test('a not-installed adapter with no sessions is dropped entirely, not shown as empty', () => {
    const merged = mergeInstalledHarnesses(
      [],
      [adapter({ id: 'fake', probe: { installed: false, roots: [], notes: [] } })],
    );
    expect(merged).toEqual([]);
  });

  test('a harness present in both the aggregate list and the adapter list is not duplicated', () => {
    const merged = mergeInstalledHarnesses([WITH_SESSIONS], [adapter({ id: 'claude-code' })]);
    expect(merged).toHaveLength(1);
  });

  test('real aggregates and empty placeholders both survive a mixed adapter list', () => {
    const merged = mergeInstalledHarnesses(
      [WITH_SESSIONS],
      [adapter({ id: 'claude-code' }), adapter({ id: 'codex', displayName: 'Codex' })],
    );
    expect(merged.map((entry) => entry.harness).sort()).toEqual(['claude-code', 'codex']);
    expect(merged.find((entry) => entry.harness === 'codex')?.emptyVariant).toBe(
      'installed-no-sessions',
    );
  });
});
