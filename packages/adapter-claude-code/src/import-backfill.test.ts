import { describe, expect, test } from 'bun:test';
import { join } from 'node:path/posix';
import type {
  AdapterContext,
  AdapterReport,
  HarnessAdapter,
  ImportReport,
  RunwireFs,
} from '@runwire/core';
import { createBunFs, importAll, openStore, readImportedVersion } from '@runwire/core';
import { createClaudeCodeAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'claude-code');
const MEDIUM_HOME = join(FIXTURES_ROOT, 'medium', 'home');
const MEDIUM_SESSION = 'claude-code:3666e64a-bdeb-4ffb-82d4-ad06666a67a8';

function ctxWithFs(fs: RunwireFs): AdapterContext {
  return {
    home: MEDIUM_HOME,
    platform: 'darwin',
    env: {},
    fs,
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

function reportFor(result: ImportReport, id: string): AdapterReport {
  const report = result.perAdapter[id];
  if (!report) throw new Error(`no report for adapter "${id}"`);
  return report;
}

function sessionCount(db: ReturnType<typeof openStore>['db']): number {
  return (db.query('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
}

function legacyClaudeAdapter(): HarnessAdapter {
  const current = createClaudeCodeAdapter();
  return {
    ...current,
    adapterVersion: '2.0.0',
    async *discover(ctx, known) {
      for await (const bundle of current.discover(ctx, known)) {
        yield {
          ...bundle,
          steps: bundle.steps.map(({ mcpServer: _server, mcpTool: _tool, ...step }) => step),
        };
      }
    },
  };
}

function fsWithRootVanishingAfterProbe(real: RunwireFs, root: string): RunwireFs {
  let rootChecks = 0;
  return {
    ...real,
    async stat(path) {
      if (path === root) {
        rootChecks++;
        if (rootChecks > 1) return undefined;
      }
      return real.stat(path);
    },
    async readdir(path) {
      return path === root ? [] : real.readdir(path);
    },
  };
}

describe('claude-code: automatic historical MCP-identity backfill (real fixture + in-memory store)', () => {
  test('a legacy 2.0.0 store backfills NULL identity without force, then runs incrementally', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFs(createBunFs());

    const legacy = await importAll({ adapters: [legacyClaudeAdapter()], db, ctx });
    expect(reportFor(legacy, 'claude-code').imported).toBeGreaterThan(0);
    expect(readImportedVersion(db, 'claude-code')).toBe('2.0.0');
    const nullIdentity = db
      .query('SELECT COUNT(*) AS c FROM steps WHERE mcp_server IS NOT NULL')
      .get() as { c: number };
    expect(nullIdentity.c).toBe(0);

    const current = await importAll({ adapters: [createClaudeCodeAdapter()], db, ctx });
    expect(reportFor(current, 'claude-code').discovered).toBeGreaterThan(0);
    expect(readImportedVersion(db, 'claude-code')).toBe('2.1.0');
    const backfilled = db
      .query(
        "SELECT mcp_server, mcp_tool FROM steps WHERE tool_name = 'mcp__plugin_engram_engram__mem_save'",
      )
      .get() as { mcp_server: string | null; mcp_tool: string | null };
    expect(backfilled).toEqual({ mcp_server: 'plugin_engram_engram', mcp_tool: 'mem_save' });
    expect(sessionCount(db)).toBeGreaterThan(0);

    const third = await importAll({ adapters: [createClaudeCodeAdapter()], db, ctx });
    expect(reportFor(third, 'claude-code').discovered).toBe(0);
    expect(reportFor(third, 'claude-code').skipped).toBeGreaterThan(0);
    expect(readImportedVersion(db, 'claude-code')).toBe('2.1.0');
  });

  test('a root that vanishes after probe does not prune history or record success', async () => {
    const { db } = openStore(':memory:');
    const root = join(MEDIUM_HOME, '.claude', 'projects');
    const real = createBunFs();

    await importAll({ adapters: [createClaudeCodeAdapter()], db, ctx: ctxWithFs(real) });
    const before = sessionCount(db);
    expect(before).toBeGreaterThan(0);
    expect(readImportedVersion(db, 'claude-code')).toBe('2.1.0');

    const second = await importAll({
      adapters: [createClaudeCodeAdapter()],
      db,
      ctx: ctxWithFs(fsWithRootVanishingAfterProbe(real, root)),
    });

    const report = reportFor(second, 'claude-code');
    expect(report.error).toBeTruthy();
    expect(report.removed).toBe(0);
    expect(sessionCount(db)).toBe(before);
    expect(readImportedVersion(db, 'claude-code')).toBeNull();
    expect(db.query('SELECT id FROM sessions WHERE id = ?').get(MEDIUM_SESSION)).not.toBeNull();
  });
});
