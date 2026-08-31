import { describe, expect, test } from 'vitest';
import type { Confidence, HarnessId, Metric, SessionRollup, SessionSummary } from '../../api/types';
import { applyFilters, distinctOptions, emptyFilters, type SessionFilters } from './filters';
import { toSessionRow, toSessionRows } from './model';

function metric<T>(value: T, confidence: Confidence = 'high'): Metric<T> {
  return { value, confidence, source: 'fixture' };
}

type SummaryOverrides = {
  id?: string;
  harness?: HarnessId;
  title?: string;
  projectKey?: string;
  projectName?: string;
  model?: string;
  mode?: string;
  startedAt?: string;
  durationMs?: number;
  uncachedInput?: number;
  output?: number;
  children?: string[];
};

function makeSummary(overrides: SummaryOverrides = {}): SessionSummary {
  const id = overrides.id ?? 'claude-code:abcdef1234';
  return {
    id,
    harness: overrides.harness ?? 'claude-code',
    depth: 0,
    title:
      overrides.title === undefined ? undefined : { value: overrides.title, contentDerived: true },
    project: {
      key: overrides.projectKey ?? 'github.com/acme/scout',
      name: overrides.projectName ?? 'scout',
      identity: 'remote',
    },
    cwd: { first: '/tmp/scout', all: ['/tmp/scout'] },
    timing: {
      startedAt: overrides.startedAt === undefined ? undefined : metric(overrides.startedAt),
      durationMs: overrides.durationMs === undefined ? undefined : metric(overrides.durationMs),
    },
    model: {
      primary: overrides.model === undefined ? undefined : metric(overrides.model),
      all: [],
      changes: 0,
    },
    mode:
      overrides.mode === undefined
        ? undefined
        : { primary: metric(overrides.mode), all: [overrides.mode], changes: 0 },
    flags: {},
    usage: {
      uncachedInput:
        overrides.uncachedInput === undefined ? undefined : metric(overrides.uncachedInput),
      output: overrides.output === undefined ? undefined : metric(overrides.output),
    },
    counts: {},
    children: overrides.children ?? [],
    source: { path: `/tmp/${id}.jsonl`, sizeBytes: 1, mtimeMs: 0 },
    diagnostics: [],
  };
}

function makeRollup(id: string, inclusiveOutput: number, subagents: number): SessionRollup {
  return {
    id,
    exclusive: { usage: {}, counts: {} },
    inclusive: {
      usage: { output: metric(inclusiveOutput) },
      counts: { subagents: metric(subagents) },
    },
    descendants: subagents,
  };
}

const PREFS = { inclusive: false, showTitles: true };

function rowOf(overrides: SummaryOverrides = {}) {
  return toSessionRow(makeSummary(overrides), undefined, PREFS);
}

/** Local-time construction keeps every date assertion timezone-independent. */
function localIso(year: number, monthIndex: number, day: number, hour = 9): string {
  return new Date(year, monthIndex, day, hour, 0, 0, 0).toISOString();
}

const NOW = new Date(2026, 7, 31, 12, 0, 0, 0);

function filtersWith(patch: Partial<SessionFilters>): SessionFilters {
  return { ...emptyFilters(), ...patch };
}

describe('toSessionRow', () => {
  test('label uses the title when titles are on, shortId when they are off', () => {
    const summary = makeSummary({ id: 'claude-code:abcdef1234', title: 'Refactor The Parser' });

    expect(toSessionRow(summary, undefined, { inclusive: true, showTitles: true }).label).toBe(
      'Refactor The Parser',
    );
    expect(toSessionRow(summary, undefined, { inclusive: true, showTitles: false }).label).toBe(
      'abcdef12',
    );
  });

  test('label falls back to shortId when the session has no title', () => {
    expect(rowOf({ id: 'claude-code:0011223344' }).label).toBe('00112233');
  });

  test('usage follows the inclusive toggle, subagents never do', () => {
    const summary = makeSummary({ id: 's1', output: 100, children: ['s2'] });
    const rollup = makeRollup('s1', 900, 3);

    const exclusive = toSessionRow(summary, rollup, { inclusive: false, showTitles: true });
    const inclusive = toSessionRow(summary, rollup, { inclusive: true, showTitles: true });

    expect(exclusive.usage.output?.value).toBe(100);
    expect(inclusive.usage.output?.value).toBe(900);
    expect(exclusive.subagents?.value).toBe(3);
    expect(inclusive.subagents?.value).toBe(3);
  });

  test('hasSubagents comes from the child list, not from the rollup count', () => {
    expect(rowOf({ children: [] }).hasSubagents).toBe(false);
    expect(rowOf({ children: ['claude-code:child'] }).hasSubagents).toBe(true);
  });

  test('inclusive view falls back to the session usage when no rollup was returned', () => {
    const row = toSessionRow(makeSummary({ output: 42 }), undefined, {
      inclusive: true,
      showTitles: true,
    });
    expect(row.usage.output?.value).toBe(42);
  });

  test('toSessionRows pairs each summary with its own rollup', () => {
    const a = makeSummary({ id: 'a', output: 1 });
    const b = makeSummary({ id: 'b', output: 2 });
    const rows = toSessionRows(
      [a, b],
      { a: makeRollup('a', 10, 1) },
      { inclusive: true, showTitles: true },
    );

    expect(rows.map((row) => row.usage.output?.value)).toEqual([10, 2]);
    expect(rows.map((row) => row.subagents?.value)).toEqual([1, undefined]);
  });
});

describe('applyFilters — one criterion at a time', () => {
  test('harness', () => {
    const rows = [rowOf({ id: 'a', harness: 'claude-code' }), rowOf({ id: 'b', harness: 'codex' })];
    expect(applyFilters(rows, filtersWith({ harness: ['codex'] }), NOW).map((r) => r.id)).toEqual([
      'b',
    ]);
  });

  test('project matches the key, not the display name', () => {
    const rows = [
      rowOf({ id: 'a', projectKey: 'github.com/acme/one', projectName: 'shared' }),
      rowOf({ id: 'b', projectKey: 'github.com/acme/two', projectName: 'shared' }),
    ];
    expect(
      applyFilters(rows, filtersWith({ project: ['github.com/acme/two'] }), NOW).map((r) => r.id),
    ).toEqual(['b']);
  });

  test('model', () => {
    const rows = [rowOf({ id: 'a', model: 'opus' }), rowOf({ id: 'b', model: 'sonnet' })];
    expect(applyFilters(rows, filtersWith({ model: ['opus'] }), NOW).map((r) => r.id)).toEqual([
      'a',
    ]);
  });

  test('mode', () => {
    const rows = [rowOf({ id: 'a', mode: 'plan' }), rowOf({ id: 'b', mode: 'default' })];
    expect(applyFilters(rows, filtersWith({ mode: ['plan'] }), NOW).map((r) => r.id)).toEqual([
      'a',
    ]);
  });

  test('a row missing the filtered field is excluded, never silently kept', () => {
    const rows = [rowOf({ id: 'a', model: 'opus' }), rowOf({ id: 'b' })];
    expect(applyFilters(rows, filtersWith({ model: ['opus'] }), NOW).map((r) => r.id)).toEqual([
      'a',
    ]);
  });

  test('subagents any / with / without', () => {
    const rows = [rowOf({ id: 'lonely' }), rowOf({ id: 'parent', children: ['kid'] })];

    expect(applyFilters(rows, filtersWith({ subagents: 'any' }), NOW)).toHaveLength(2);
    expect(applyFilters(rows, filtersWith({ subagents: 'with' }), NOW).map((r) => r.id)).toEqual([
      'parent',
    ]);
    expect(applyFilters(rows, filtersWith({ subagents: 'without' }), NOW).map((r) => r.id)).toEqual(
      ['lonely'],
    );
  });

  test('search matches the label case-insensitively', () => {
    const rows = [
      rowOf({ id: 'claude-code:aaaa1111', title: 'Refactor The Parser' }),
      rowOf({ id: 'claude-code:bbbb2222', title: 'Ship the docs' }),
    ];
    expect(
      applyFilters(rows, filtersWith({ search: 'REFACTOR' }), NOW).map((r) => r.label),
    ).toEqual(['Refactor The Parser']);
  });

  test('search matches the id case-insensitively', () => {
    const rows = [
      rowOf({ id: 'claude-code:ABCDEF12', title: 'one' }),
      rowOf({ id: 'claude-code:99887766', title: 'two' }),
    ];
    expect(applyFilters(rows, filtersWith({ search: 'abcdef' }), NOW).map((r) => r.label)).toEqual([
      'one',
    ]);
  });

  test('a blank or whitespace-only search narrows nothing', () => {
    const rows = [rowOf({ id: 'a' }), rowOf({ id: 'b' })];
    expect(applyFilters(rows, filtersWith({ search: '   ' }), NOW)).toHaveLength(2);
  });
});

describe('applyFilters — empty arrays mean no narrowing', () => {
  test('every list empty keeps every row', () => {
    const rows = [
      rowOf({ id: 'a', harness: 'claude-code', model: 'opus', mode: 'plan' }),
      rowOf({ id: 'b', harness: 'codex' }),
    ];
    expect(applyFilters(rows, emptyFilters(), NOW)).toHaveLength(2);
  });
});

describe('applyFilters — date', () => {
  const today = rowOf({ id: 'today', startedAt: localIso(2026, 7, 31) });
  const yesterday = rowOf({ id: 'yesterday', startedAt: localIso(2026, 7, 30) });
  const tenDaysAgo = rowOf({ id: 'ten', startedAt: localIso(2026, 7, 21) });
  const fortyDaysAgo = rowOf({ id: 'forty', startedAt: localIso(2026, 6, 22) });
  const undated = rowOf({ id: 'undated' });
  const rows = [today, yesterday, tenDaysAgo, fortyDaysAgo, undated];

  test('all keeps everything including undated rows', () => {
    expect(applyFilters(rows, filtersWith({ date: { preset: 'all' } }), NOW)).toHaveLength(5);
  });

  test('today keeps only sessions since local midnight', () => {
    expect(
      applyFilters(rows, filtersWith({ date: { preset: 'today' } }), NOW).map((r) => r.id),
    ).toEqual(['today']);
  });

  test('7d and 30d windows', () => {
    expect(
      applyFilters(rows, filtersWith({ date: { preset: '7d' } }), NOW).map((r) => r.id),
    ).toEqual(['today', 'yesterday']);
    expect(
      applyFilters(rows, filtersWith({ date: { preset: '30d' } }), NOW).map((r) => r.id),
    ).toEqual(['today', 'yesterday', 'ten']);
  });

  test('every preset except all drops rows with no startedAt', () => {
    for (const preset of ['today', '7d', '30d', 'custom'] as const) {
      const kept = applyFilters([undated], filtersWith({ date: { preset } }), NOW);
      expect(kept, `preset ${preset} must exclude undated rows`).toHaveLength(0);
    }
  });

  test('custom range is inclusive at both ends of the named days', () => {
    const atStart = toSessionRow(
      makeSummary({ id: 'start', startedAt: new Date(2026, 7, 30, 0, 0, 0, 0).toISOString() }),
      undefined,
      PREFS,
    );
    const atEnd = toSessionRow(
      makeSummary({ id: 'end', startedAt: new Date(2026, 7, 30, 23, 59, 59, 999).toISOString() }),
      undefined,
      PREFS,
    );

    const kept = applyFilters(
      [atStart, atEnd, today, tenDaysAgo],
      filtersWith({ date: { preset: 'custom', from: '2026-08-30', to: '2026-08-30' } }),
      NOW,
    );
    expect(kept.map((r) => r.id)).toEqual(['start', 'end']);
  });

  test('custom range with only one bound applies only that bound', () => {
    expect(
      applyFilters(rows, filtersWith({ date: { preset: 'custom', from: '2026-08-30' } }), NOW).map(
        (r) => r.id,
      ),
    ).toEqual(['today', 'yesterday']);
    expect(
      applyFilters(rows, filtersWith({ date: { preset: 'custom', to: '2026-07-31' } }), NOW).map(
        (r) => r.id,
      ),
    ).toEqual(['forty']);
  });
});

describe('applyFilters — combined', () => {
  test('filters intersect', () => {
    const rows = [
      rowOf({
        id: 'hit',
        harness: 'claude-code',
        model: 'opus',
        title: 'Ship it',
        startedAt: localIso(2026, 7, 31),
        children: ['kid'],
      }),
      rowOf({ id: 'wrong-model', harness: 'claude-code', model: 'sonnet', title: 'Ship it' }),
      rowOf({ id: 'wrong-harness', harness: 'codex', model: 'opus', title: 'Ship it' }),
      rowOf({ id: 'no-subagents', harness: 'claude-code', model: 'opus', title: 'Ship it' }),
    ];

    const kept = applyFilters(
      rows,
      filtersWith({
        harness: ['claude-code'],
        model: ['opus'],
        subagents: 'with',
        search: 'ship',
        date: { preset: 'today' },
      }),
      NOW,
    );
    expect(kept.map((r) => r.id)).toEqual(['hit']);
  });
});

describe('distinctOptions', () => {
  test('collects distinct values and labels projects by name', () => {
    const rows = [
      rowOf({
        id: 'a',
        harness: 'claude-code',
        projectKey: 'github.com/acme/two',
        projectName: 'two',
        model: 'opus',
        mode: 'plan',
      }),
      rowOf({
        id: 'b',
        harness: 'claude-code',
        projectKey: 'github.com/acme/one',
        projectName: 'one',
        model: 'opus',
      }),
    ];

    const options = distinctOptions(rows);
    expect(options.harness).toEqual([{ value: 'claude-code', label: 'claude-code' }]);
    expect(options.project).toEqual([
      { value: 'github.com/acme/one', label: 'one' },
      { value: 'github.com/acme/two', label: 'two' },
    ]);
    expect(options.model).toEqual([{ value: 'opus', label: 'opus' }]);
    expect(options.mode).toEqual([{ value: 'plan', label: 'plan' }]);
  });
});
