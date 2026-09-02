import { describe, expect, test } from 'bun:test';
import {
  CLAUDE_CODE_ENTRYPOINTS,
  CLAUDE_CODE_PROMPT_SOURCES,
  classifyInitiator,
} from './initiator';

/**
 * The full `entrypoint` value space extracted from the Claude Code binary
 * (2.1.257), with the verdict each value must produce. Kept as one literal
 * table so a value silently dropped from the classifier's maps shows up as a
 * `unknown`/`low` mismatch on a named row rather than as missing coverage.
 */
const ENTRYPOINT_TABLE: ReadonlyArray<{
  entrypoint: string;
  kind: 'human' | 'machine';
  confidence: 'high' | 'medium';
  automation?: string;
}> = [
  // --- machine, high ---
  { entrypoint: 'sdk-cli', kind: 'machine', confidence: 'high', automation: 'sdk' },
  { entrypoint: 'sdk-ts', kind: 'machine', confidence: 'high', automation: 'sdk' },
  { entrypoint: 'sdk-py', kind: 'machine', confidence: 'high', automation: 'sdk' },
  {
    entrypoint: 'claude-code-github-action',
    kind: 'machine',
    confidence: 'high',
    automation: 'ci',
  },
  { entrypoint: 'mcp', kind: 'machine', confidence: 'high' },
  { entrypoint: 'bench', kind: 'machine', confidence: 'high' },
  { entrypoint: 'local-agent', kind: 'machine', confidence: 'high' },
  { entrypoint: 'local_agent', kind: 'machine', confidence: 'high' },
  { entrypoint: 'claude-security', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote_baku', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote_cowork', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote_trigger', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote_cowork_trigger', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote_desktop', kind: 'machine', confidence: 'high' },
  { entrypoint: 'remote_mobile', kind: 'machine', confidence: 'high' },
  // --- human, medium (never high: the surface is interaction-capable, which
  // is not the same as "a person typed" - `claude -p` in CI reports `cli`) ---
  { entrypoint: 'cli', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-desktop', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-desktop-3p', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-vscode', kind: 'human', confidence: 'medium' },
  { entrypoint: 'ssh-remote', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude_in_slack', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-in-slack', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-in-teams', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-coworker', kind: 'human', confidence: 'medium' },
  { entrypoint: 'claude-coworker-terminal', kind: 'human', confidence: 'medium' },
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
    test(`${row.entrypoint} -> ${row.kind} (${row.confidence})`, () => {
      expect(classifyInitiator({ entrypoint: row.entrypoint, dispatched: false })).toEqual({
        kind: row.kind,
        surface: row.entrypoint,
        ...(row.automation ? { automation: row.automation } : {}),
        confidence: row.confidence,
      });
    });
  }

  test('the machine majority observed on real disk (sdk-cli + sdk-py) is high-confidence sdk', () => {
    // 184 sdk-cli + 124 sdk-py = 308 of 383 real roots (80.4%).
    for (const surface of ['sdk-cli', 'sdk-py']) {
      const result = classifyInitiator({ entrypoint: surface, dispatched: false });
      expect(result?.kind).toBe('machine');
      expect(result?.automation).toBe('sdk');
      expect(result?.confidence).toBe('high');
    }
  });
});

describe('classifyInitiator: the dispatch marker', () => {
  test('a dispatched cli root is machine/subagent-dispatch, keeping cli as the surface', () => {
    // The 10 real `cli` roots that are agent-dispatched workers: entrypoint
    // alone calls these human, and they hold ~96% of the hidden token mass.
    expect(classifyInitiator({ entrypoint: 'cli', dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'cli',
      automation: 'subagent-dispatch',
      confidence: 'medium',
    });
  });

  test('medium, not high: the marker is framework-specific and absent from older sessions', () => {
    expect(classifyInitiator({ entrypoint: 'cli', dispatched: true })?.confidence).toBe('medium');
  });

  test('it upgrades an unknown surface to machine without inventing a surface', () => {
    expect(classifyInitiator({ entrypoint: 'brand-new-surface', dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'brand-new-surface',
      automation: 'subagent-dispatch',
      confidence: 'medium',
    });
  });

  test('it never downgrades an already-machine surface or overwrites its automation', () => {
    expect(classifyInitiator({ entrypoint: 'sdk-py', dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'sdk-py',
      automation: 'sdk',
      confidence: 'high',
    });
  });

  test('with no entrypoint at all it still yields machine, with an explicit unknown surface', () => {
    expect(classifyInitiator({ dispatched: true })).toEqual({
      kind: 'machine',
      surface: 'unknown',
      automation: 'subagent-dispatch',
      confidence: 'medium',
    });
  });
});

describe('classifyInitiator: the open-set / unknown branch', () => {
  test('an entrypoint outside every list degrades to unknown rather than guessing', () => {
    expect(
      classifyInitiator({ entrypoint: 'claude-in-some-2027-surface', dispatched: false }),
    ).toEqual({ kind: 'unknown', surface: 'claude-in-some-2027-surface', confidence: 'low' });
  });

  test('no signal at all returns undefined, so "never knew" stays distinct from "unrecognized"', () => {
    expect(classifyInitiator({ dispatched: false })).toBeUndefined();
  });

  test('an empty-string entrypoint is treated as an unrecognized value, not as absent', () => {
    // '' is falsy, so a caller finding it via `.find(r => r.entrypoint)` will
    // pass undefined; a caller passing it explicitly must not crash.
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
    // Guards the verified trap: promptSource 'sdk' covers all 308 machine
    // roots AND the one claude-desktop root that is unambiguously human
    // (13.3h, 86.5M tokens, 23 user turns). Classifying on it would
    // misclassify that session as machine.
    const signals = { entrypoint: 'claude-desktop', dispatched: false };
    expect(classifyInitiator({ ...signals, ...({ promptSource: 'sdk' } as object) })).toEqual(
      classifyInitiator(signals),
    );
    expect(classifyInitiator(signals)?.kind).toBe('human');
  });
});
