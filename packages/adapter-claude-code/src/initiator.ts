import type { InitiatorKind } from '@runwire/core';

export const UNKNOWN_SURFACE = 'unknown';

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

export const CLAUDE_CODE_ENTRYPOINTS: ReadonlySet<string> = new Set([
  ...MACHINE_ENTRYPOINTS.keys(),
  ...HUMAN_ENTRYPOINTS,
]);

export const CLAUDE_CODE_PROMPT_SOURCES: ReadonlySet<string> = new Set([
  'typed',
  'queued',
  'sdk',
  'system',
]);

export type ClaudeCodeInitiatorSignals = {
  entrypoint?: string;
  dispatched: boolean;
};

export type ClassifiedInitiator = {
  kind: InitiatorKind;
  surface: string;
  automation?: string;
};

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
