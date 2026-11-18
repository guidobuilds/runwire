import { describe, expect, test } from 'bun:test';
import {
  CLAUDE_CODE_ENTRYPOINTS,
  CLAUDE_CODE_PROMPT_SOURCES,
  classifyInitiator,
} from './initiator';

const ENTRYPOINT_TABLE: ReadonlyArray<{
  entrypoint: string;
  kind: 'human' | 'machine';
  automation?: string;
}> = [
  { entrypoint: 'sdk-cli', kind: 'machine', automation: 'sdk' },
  { entrypoint: 'sdk-ts', kind: 'machine', automation: 'sdk' },
  { entrypoint: 'sdk-py', kind: 'machine', automation: 'sdk' },
  { entrypoint: 'claude-code-github-action', kind: 'machine', automation: 'ci' },
  { entrypoint: 'mcp', kind: 'machine' },
  { entrypoint: 'bench', kind: 'machine' },
  { entrypoint: 'local-agent', kind: 'machine' },
  { entrypoint: 'local_agent', kind: 'machine' },
  { entrypoint: 'claude-security', kind: 'machine' },
  { entrypoint: 'remote', kind: 'machine' },
  { entrypoint: 'remote_baku', kind: 'machine' },
  { entrypoint: 'remote_cowork', kind: 'machine' },
  { entrypoint: 'remote_trigger', kind: 'machine' },
  { entrypoint: 'remote_cowork_trigger', kind: 'machine' },
  { entrypoint: 'remote_desktop', kind: 'machine' },
  { entrypoint: 'remote_mobile', kind: 'machine' },
  { entrypoint: 'cli', kind: 'human' },
  { entrypoint: 'claude-desktop', kind: 'human' },
  { entrypoint: 'claude-desktop-3p', kind: 'human' },
  { entrypoint: 'claude-vscode', kind: 'human' },
  { entrypoint: 'ssh-remote', kind: 'human' },
  { entrypoint: 'claude_in_slack', kind: 'human' },
  { entrypoint: 'claude-in-slack', kind: 'human' },
  { entrypoint: 'claude-in-teams', kind: 'human' },
  { entrypoint: 'claude-coworker', kind: 'human' },
  { entrypoint: 'claude-coworker-terminal', kind: 'human' },
];

describe('classifyInitiator: the entrypoint table', () => {
  test('covers the whole known value space (26 values, none classified twice)', () => {
    expect(ENTRYPOINT_TABLE).toHaveLength(26);
    expect(new Set(ENTRYPOINT_TABLE.map((r) => r.entrypoint)).size).toBe(26);
    expect(new Set(ENTRYPOINT_TABLE.map((r) => r.entrypoint))).toEqual(
      new Set(CLAUDE_CODE_ENTRYPOINTS),
    );
  });

  for (const row of ENTRYPOINT_TABLE) {
    test(`${row.entrypoint} -> ${row.kind}`, () => {
      expect(classifyInitiator({ entrypoint: row.entrypoint, dispatched: false })).toEqual({
        kind: row.kind,
        surface: row.entrypoint,
        ...(row.automation ? { automation: row.automation } : {}),
      });
    });
  }

  test('the machine majority observed on real disk (sdk-cli + sdk-py) is sdk', () => {
    for (const surface of ['sdk-cli', 'sdk-py']) {
      const result = classifyInitiator({ entrypoint: surface, dispatched: false });
      expect(result?.kind).toBe('machine');
      expect(result?.automation).toBe('sdk');
    }
  });
});

describe('classifyInitiator: the dispatch marker', () => {
  test('a dispatched cli root is machine/subagent-dispatch, keeping cli as the surface', () => {
    expect(classifyInitiator({ entrypoint: 'cli', dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'cli',
      automation: 'subagent-dispatch',
    });
  });

  test('it upgrades an unknown surface to machine without inventing a surface', () => {
    expect(classifyInitiator({ entrypoint: 'brand-new-surface', dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'brand-new-surface',
      automation: 'subagent-dispatch',
    });
  });

  test('it never downgrades an already-machine surface or overwrites its automation', () => {
    expect(classifyInitiator({ entrypoint: 'sdk-py', dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'sdk-py',
      automation: 'sdk',
    });
  });

  test('with no entrypoint at all it still yields machine, with an explicit unknown surface', () => {
    expect(classifyInitiator({ dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'unknown',
      automation: 'subagent-dispatch',
    });
  });
});

describe('classifyInitiator: the open-set / unknown branch', () => {
  test('an entrypoint outside every list degrades to unknown rather than guessing', () => {
    expect(
      classifyInitiator({ entrypoint: 'claude-in-some-2027-surface', dispatched: false }),
    ).toEqual({ kind: 'unknown', surface: 'claude-in-some-2027-surface' });
  });

  test('no signal at all returns undefined, so "never knew" stays distinct from "unrecognized"', () => {
    expect(classifyInitiator({ dispatched: false })).toBeUndefined();
  });

  test('an empty-string entrypoint is treated as an unrecognized value, not as absent', () => {
    expect(classifyInitiator({ entrypoint: '', dispatched: false })?.kind).toBe('unknown');
  });
});

describe('promptSource is allowlisted but never classified on', () => {
  test('its vocabulary is exactly the four CLI values', () => {
    expect(new Set(CLAUDE_CODE_PROMPT_SOURCES)).toEqual(
      new Set(['typed', 'queued', 'sdk', 'system']),
    );
  });

  test('it is not an input to the classifier at all', () => {
    const signals = { entrypoint: 'claude-desktop', dispatched: false };
    expect(classifyInitiator({ ...signals, ...({ promptSource: 'sdk' } as object) })).toEqual(
      classifyInitiator(signals),
    );
    expect(classifyInitiator(signals)?.kind).toBe('human');
  });
});
