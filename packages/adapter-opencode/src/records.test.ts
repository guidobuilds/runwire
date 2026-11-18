import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, SqliteReader } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { opencodeDbPath } from './paths';
import {
  attachSpawnCallIds,
  type OpenCodeMessage,
  type OpenCodeSession,
  ORIGIN_READ_FAILED_MESSAGE,
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
    expect(records.kind).toBe('not-opencode');
    expect(records.sessions).toHaveLength(0);
    expect(records.messagesBySession.size).toBe(0);
    expect(records.diagnostics).toHaveLength(0);
  });

  test('a present-but-unreadable DB yields kind unreadable and the fixed fatal diagnostic', async () => {
    const base = ctxFor('small');
    const currentPath = opencodeDbPath(base, 'current');
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path: string) =>
          path === currentPath
            ? { sizeBytes: 8, mtimeMs: 0, isDirectory: false }
            : base.fs.stat(path),
        openSqliteReadonly: (path: string) => {
          if (path === currentPath) throw new Error('SQLITE_NOTADB: file is not a database');
          return base.fs.openSqliteReadonly(path);
        },
      },
    };
    const records = await readOrigin(ctx, 'current');
    expect(records.kind).toBe('unreadable');
    expect(records.sessions).toHaveLength(0);
    const fatal = records.diagnostics.filter((d) => d.code === 'source-read-failed');
    expect(fatal).toHaveLength(1);
    expect(fatal[0]?.level).toBe('error');
    expect(fatal[0]?.message).toBe(ORIGIN_READ_FAILED_MESSAGE);
    expect(JSON.stringify(records)).not.toContain('SQLITE_NOTADB');
  });

  test('a read failure after successful detection converges on the fixed fatal diagnostic', async () => {
    const base = ctxFor('small');
    const currentPath = opencodeDbPath(base, 'current');
    let opens = 0;
    const detectReader: SqliteReader = {
      all<T = Record<string, unknown>>(): T[] {
        return [{ name: 'session_v2' }] as T[];
      },
      close() {},
    };
    const brokenReader: SqliteReader = {
      all<T = Record<string, unknown>>(): T[] {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      },
      close() {},
    };
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path: string) =>
          path === currentPath
            ? { sizeBytes: 8, mtimeMs: 0, isDirectory: false }
            : base.fs.stat(path),
        openSqliteReadonly: () => {
          opens++;
          return opens === 1 ? detectReader : brokenReader;
        },
      },
    };
    const records = await readOrigin(ctx, 'current');
    expect(records.kind).toBe('current');
    expect(records.sessions).toHaveLength(0);
    const fatal = records.diagnostics.filter((d) => d.code === 'source-read-failed');
    expect(fatal).toHaveLength(1);
    expect(fatal[0]?.level).toBe('error');
    expect(fatal[0]?.message).toBe(ORIGIN_READ_FAILED_MESSAGE);
    expect(JSON.stringify(records)).not.toContain('SQLITE_CORRUPT');
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
      ['other', [assistant(1, 'wrong-parent', 'unlinked')]],
    ]);

    attachSpawnCallIds(sessions, messages);

    expect(sessions.find((s) => s.id === 'child')?.spawnCallId).toBe('spawn-child');
    expect(sessions.find((s) => s.id === 'grandchild')?.spawnCallId).toBe('spawn-grandchild');
    expect(sessions.find((s) => s.id === 'unlinked')?.spawnCallId).toBeUndefined();
  });
});
