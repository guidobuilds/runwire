import type { InitiatorKind } from '@runwire/core';

/**
 * Classifies who started a Claude Code session
 * (docs/adapters/claude-code.md "Initiator").
 *
 * The primary signal is the record-level `entrypoint` field, a closed enum in
 * the CLI binary naming the *surface* the session came in on. The secondary
 * signal is the presence of an `agent-setting` record, which Claude Code
 * writes when the session was dispatched by another agent rather than opened
 * by a person; it is orthogonal to `entrypoint` and only its presence is read
 * (never its value).
 *
 * `promptSource` is deliberately NOT used. Its `sdk` value is emitted both by
 * genuine SDK sessions and by the `claude-desktop` surface, so it cannot
 * separate the two; it is allowlisted for diagnostics only.
 */

/** Surface used when the harness reported no `entrypoint` at all. */
export const UNKNOWN_SURFACE = 'unknown';

/**
 * Machine surfaces: no interactive human is possible on these, so the
 * classification is `high` confidence. Value is the `automation` refinement,
 * or `undefined` when the surface says "machine" without saying how.
 */
const MACHINE_ENTRYPOINTS: ReadonlyMap<string, string | undefined> = new Map([
  ['sdk-cli', 'sdk'],
  ['sdk-ts', 'sdk'],
  ['sdk-py', 'sdk'],
  ['claude-code-github-action', 'ci'],
  ['mcp', undefined],
  ['bench', undefined],
  ['local-agent', undefined],
  ['local_agent', undefined],
  ['claude-security', undefined],
  ['remote', undefined],
  ['remote_baku', undefined],
  ['remote_cowork', undefined],
  ['remote_trigger', undefined],
  ['remote_cowork_trigger', undefined],
  ['remote_desktop', undefined],
  ['remote_mobile', undefined],
]);

/**
 * Interactive surfaces. Only ever `medium`: the harness reports a surface
 * *capable* of interaction, not that a person typed. A scripted `claude -p`
 * in CI reports `cli` exactly like a person at a terminal does.
 */
const HUMAN_ENTRYPOINTS: ReadonlySet<string> = new Set([
  'cli',
  'claude-desktop',
  'claude-desktop-3p',
  'claude-vscode',
  'ssh-remote',
  'claude_in_slack',
  'claude-in-slack',
  'claude-in-teams',
  'claude-coworker',
  'claude-coworker-terminal',
]);

/**
 * Every `entrypoint` value known to this adapter, for the dev-only fixture
 * redactor's vocabulary check (apps/runwire/src/fixture.ts). An unlisted value
 * is still handled at runtime - it classifies as `unknown` - so this set is a
 * privacy bound, not a validation gate.
 */
export const CLAUDE_CODE_ENTRYPOINTS: ReadonlySet<string> = new Set([
  ...MACHINE_ENTRYPOINTS.keys(),
  ...HUMAN_ENTRYPOINTS,
]);

/** The four values `promptSource` takes. Diagnostic-only; never classified on. */
export const CLAUDE_CODE_PROMPT_SOURCES: ReadonlySet<string> = new Set([
  'typed',
  'queued',
  'sdk',
  'system',
]);

export type ClaudeCodeInitiatorSignals = {
  /** Raw `entrypoint` as observed on any record, or undefined if absent. */
  entrypoint?: string;
  /** True when the source contained at least one `agent-setting` record. */
  dispatched: boolean;
};

export type ClassifiedInitiator = {
  kind: InitiatorKind;
  surface: string;
  automation?: string;
};

/**
 * Returns undefined only when the source carried no initiator signal at all
 * (pre-`entrypoint` sessions), so that "we never knew" stays distinguishable
 * from "we saw a value we do not recognize" (`kind: 'unknown'`).
 *
 * There is no exhaustive match here on purpose: `entrypoint` is an open set
 * across harness versions, and an unrecognized value must degrade to
 * `unknown` rather than break the adapter.
 */
export function classifyInitiator(
  signals: ClaudeCodeInitiatorSignals,
): ClassifiedInitiator | undefined {
  const { entrypoint, dispatched } = signals;

  if (entrypoint === undefined) {
    if (!dispatched) return undefined;
    return {
      kind: 'machine',
      surface: UNKNOWN_SURFACE,
      automation: 'subagent-dispatch',
    };
  }

  const base = classifyEntrypoint(entrypoint);

  // The dispatch marker only ever *upgrades* a non-machine verdict. Applying
  // it over an already-machine surface would replace a more specific
  // automation (e.g. 'sdk') with a weaker one.
  if (dispatched && base.kind !== 'machine') {
    return {
      kind: 'machine',
      surface: base.surface,
      automation: 'subagent-dispatch',
    };
  }

  return base;
}

function classifyEntrypoint(entrypoint: string): ClassifiedInitiator {
  if (MACHINE_ENTRYPOINTS.has(entrypoint)) {
    const automation = MACHINE_ENTRYPOINTS.get(entrypoint);
    return {
      kind: 'machine',
      surface: entrypoint,
      ...(automation ? { automation } : {}),
    };
  }
  if (HUMAN_ENTRYPOINTS.has(entrypoint)) {
    return { kind: 'human', surface: entrypoint };
  }
  return { kind: 'unknown', surface: entrypoint };
}
