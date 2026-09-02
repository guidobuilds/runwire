import { describe, expect, test } from 'vitest';
import type { Initiator, SessionSummary } from '../api/types';
import { isMachineInitiated } from './initiator';

function summaryWith(initiator: Initiator | undefined): SessionSummary {
  return {
    id: 'claude-code:s1',
    harness: 'claude-code',
    depth: 0,
    initiator:
      initiator === undefined
        ? undefined
        : { value: initiator, confidence: 'high', source: 'claude-code/initiator' },
    project: { key: 'k', name: 'proj', identity: 'remote' },
    cwd: { first: '/tmp/work', all: ['/tmp/work'] },
    timing: {},
    model: { all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    children: [],
    source: { path: '/tmp/s1.jsonl', sizeBytes: 10, mtimeMs: 0 },
    diagnostics: [],
  };
}

/**
 * Web's copy of core's `isMachineInitiated` (see the doc comment there for why
 * it is a copy). The table below is the same set of branches
 * `packages/core/src/scan/store.test.ts` drives through the core predicate, so
 * the two cannot drift without one of the two suites going red.
 */
describe('isMachineInitiated', () => {
  test('true only for kind: machine', () => {
    expect(isMachineInitiated(summaryWith({ kind: 'machine', surface: 'sdk-py' }))).toBe(true);
    expect(
      isMachineInitiated(
        summaryWith({ kind: 'machine', surface: 'cli', automation: 'subagent-dispatch' }),
      ),
    ).toBe(true);
  });

  test('false for human', () => {
    expect(isMachineInitiated(summaryWith({ kind: 'human', surface: 'cli' }))).toBe(false);
    // The claude-desktop trap: a human surface whose promptSource is `sdk`.
    // `promptSource` is not an input to the verdict, so this stays human.
    expect(isMachineInitiated(summaryWith({ kind: 'human', surface: 'claude-desktop' }))).toBe(
      false,
    );
  });

  test('false for an unrecognised surface and for no signal at all', () => {
    // The conservative half of the contract: the product only ever hides what
    // it positively knows is machine-started. A harness shipping a new
    // `entrypoint` value, or a session recorded before the field existed, must
    // stay visible.
    expect(isMachineInitiated(summaryWith({ kind: 'unknown', surface: 'some-new-surface' }))).toBe(
      false,
    );
    expect(isMachineInitiated(summaryWith(undefined))).toBe(false);
  });
});
