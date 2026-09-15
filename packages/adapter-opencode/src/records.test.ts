import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import {
  attachSpawnCallIds,
  type OpenCodeMessage,
  type OpenCodeSession,
  readOrigin,
} from './records';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'opencode');

function ctxFor(name: string): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

describe('readOrigin', () => {
  test('reads the small current store: one session + its messages in seq order', async () => {
    const records = await readOrigin(ctxFor('small'), 'current');
    expect(records.sessions).toHaveLength(1);
    const s = records.sessions[0]!;
    expect(s.id).toBe('ses_small');
    expect(s.projectId).toBe('p1');
    expect(s.directory).toBe('/home/u/proj');
    const msgs = records.messagesBySession.get('ses_small') ?? [];
    expect(msgs.map((m) => m.seq)).toEqual([4, 7, 9]);
    expect(msgs[0]?.type).toBe('user');
    expect(msgs[1]?.type).toBe('assistant');
    expect(msgs[1]?.data.model?.id).toBe('gpt-5.6-sol');
  });

  test('reads the legacy store as legacy sessions', async () => {
    const records = await readOrigin(ctxFor('legacy'), 'legacy');
    expect(records.kind).toBe('legacy');
    expect(records.sessions).toHaveLength(2);
    const ids = records.sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['ses_legacy_1', 'ses_legacy_2']);
  });

  test('a missing DB returns an empty read with no throw', async () => {
    const records = await readOrigin(ctxFor('small'), 'legacy');
    expect(records.sessions).toHaveLength(0);
    expect(records.messagesBySession.size).toBe(0);
  });

  test('a malformed message yields an invalid-record diagnostic but no throw', async () => {
    const records = await readOrigin(ctxFor('malformed'), 'current');
    expect(records.sessions).toHaveLength(1);
    const codes = records.diagnostics.map((d) => d.code);
    expect(codes).toContain('invalid-record');
  });

  test('projects are read with worktree/vcs', async () => {
    const records = await readOrigin(ctxFor('small'), 'current');
    const proj = records.projects.get('p1');
    expect(proj?.worktree).toBe('/home/u/proj');
    expect(proj?.vcs).toBe('git');
  });
});

describe('attachSpawnCallIds', () => {
  test('uses only an explicit subagent sessionID from the declared parent', () => {
    const sessions: OpenCodeSession[] = [
      { id: 'root', projectId: 'p' },
      { id: 'child', projectId: 'p', parentId: 'root' },
      { id: 'grandchild', projectId: 'p', parentId: 'child' },
      { id: 'unlinked', projectId: 'p', parentId: 'root' },
    ];
    const assistant = (
      seq: number,
      id: string,
      target: string,
      name = 'subagent',
    ): OpenCodeMessage => ({
      type: 'assistant',
      seq,
      data: {
        content: [
          {
            type: 'tool',
            id,
            name,
            state: { status: 'completed', metadata: { sessionID: target } },
          },
        ],
      },
    });
    const messages = new Map<string, OpenCodeMessage[]>([
      ['root', [assistant(1, 'spawn-child', 'child'), assistant(2, 'resume-child', 'child')]],
      ['child', [assistant(1, 'spawn-grandchild', 'grandchild')]],
      // Explicit target from the wrong parent must not link `unlinked`.
      ['other', [assistant(1, 'wrong-parent', 'unlinked')]],
    ]);

    attachSpawnCallIds(sessions, messages);

    expect(sessions.find((s) => s.id === 'child')?.spawnCallId).toBe('spawn-child');
    expect(sessions.find((s) => s.id === 'grandchild')?.spawnCallId).toBe('spawn-grandchild');
    expect(sessions.find((s) => s.id === 'unlinked')?.spawnCallId).toBeUndefined();
  });
});
