import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { computeBundle, computeDepth } from './compute';
import { type OpenCodeMessage, type OpenCodeSession, readOrigin } from './records';

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

describe('computeDepth', () => {
  test('walks the parent chain within the same origin', () => {
    const sessionsById = new Map<string, OpenCodeSession>([
      ['root', { id: 'root', projectId: 'p' }],
      ['child', { id: 'child', projectId: 'p', parentId: 'root' }],
      ['grand', { id: 'grand', projectId: 'p', parentId: 'child' }],
    ]);
    expect(computeDepth(sessionsById.get('root')!, sessionsById)).toBe(0);
    expect(computeDepth(sessionsById.get('child')!, sessionsById)).toBe(1);
    expect(computeDepth(sessionsById.get('grand')!, sessionsById)).toBe(2);
  });

  test('a missing parent stops the walk (does not loop)', () => {
    const sessionsById = new Map<string, OpenCodeSession>([
      ['orphan', { id: 'orphan', projectId: 'p', parentId: 'gone' }],
    ]);
    expect(computeDepth(sessionsById.get('orphan')!, sessionsById)).toBe(0);
  });
});

describe('computeBundle', () => {
  test('maps current name/time tool parts to CORE tool steps', async () => {
    const ctx = ctxFor('small');
    const session: OpenCodeSession = {
      id: 'current-tool',
      projectId: 'p',
      directory: '/home/u/proj',
      spawnCallId: 'parent-call',
    };
    const messages: OpenCodeMessage[] = [
      {
        type: 'assistant',
        seq: 1,
        data: {
          time: { created: 50, completed: 500 },
          content: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'subagent',
              time: { created: 100, completed: 225 },
              state: { status: 'completed', metadata: { sessionID: 'child' } },
            },
          ],
        },
      },
    ];
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session,
      messages,
      sessionsById: new Map([[session.id, session]]),
      projects: new Map(),
      recordDiagnostics: [],
      ctx,
    });

    expect(bundle.session.spawnCallId).toBe('parent-call');
    expect(bundle.session.toolCalls).toBe(1);
    expect(bundle.steps).toEqual([
      expect.objectContaining({
        kind: 'tool',
        toolName: 'subagent',
        toolCategory: 'agent',
        callId: 'tool-1',
        at: '1970-01-01T00:00:00.100Z',
        durationMs: 125,
      }),
    ]);
  });

  test('turns the small current session into the expected CORE bundle', async () => {
    const ctx = ctxFor('small');
    const records = await readOrigin(ctx, 'current');
    const session = records.sessions[0]!;
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session,
      messages: records.messagesBySession.get(session.id) ?? [],
      sessionsById,
      projects: records.projects,
      recordDiagnostics: records.diagnostics,
      ctx,
    });

    expect(bundle.session.id).toBe('opencode:current:ses_small');
    expect(bundle.session.harnessId).toBe('opencode');
    expect(bundle.project.key).toBe('/home/u/proj');
    expect(bundle.session.projectKey).toBe('/home/u/proj');
    expect(bundle.session.sourceId).toBe('opencode:current:ses_small');
    expect(bundle.session.sourcePath).toBe('opencode:current:ses_small');
    expect(bundle.session.sourceLocator).toContain('opencode.db');
    expect(bundle.session.depth).toBe(0);
    expect(bundle.session.relation).toBeUndefined();
    expect(bundle.session.uncachedInput).toBe(300);
    expect(bundle.session.output).toBe(50);
    expect(bundle.session.reasoningOutput).toBe(10);
    expect(bundle.session.cachedInput).toBe(0);
    expect(bundle.session.cacheWrite).toBe(0);
    expect(bundle.session.turns).toBe(2);
    expect(bundle.session.apiCalls).toBe(1);
    expect(bundle.session.toolCalls).toBe(1);
    expect(bundle.session.modelPrimary).toBe('gpt-5.6-sol');
    expect(bundle.steps.map((s) => s.kind)).toEqual(['turn', 'call', 'tool', 'turn']);
    expect(bundle.steps[1]?.uncachedInput).toBe(300);
  });

  test('a model-switched message yields a model-change step (legacy)', async () => {
    const ctx = ctxFor('legacy');
    const records = await readOrigin(ctx, 'legacy');
    const session = records.sessions.find((s) => s.id === 'ses_legacy_1')!;
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'legacy',
      session,
      messages: records.messagesBySession.get(session.id) ?? [],
      sessionsById,
      projects: records.projects,
      recordDiagnostics: records.diagnostics,
      ctx,
    });
    const modelChange = bundle.steps.find((s) => s.kind === 'model-change');
    expect(modelChange).toBeDefined();
    expect(modelChange?.fromValue).toBe('gpt-5.6-sol');
    expect(modelChange?.toValue).toBe('deepseek-v4-pro');
    expect(bundle.session.modelChanges).toBe(1);
    expect(bundle.session.modelPrimary).toBe('gpt-5.6-sol');
  });

  test('titles are present only when ctx.privacy.titles is on', async () => {
    const records = await readOrigin(ctxFor('small'), 'current');
    const session = records.sessions[0]!;
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    const privateCtx = { ...ctxFor('small'), privacy: { titles: false } };
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session,
      messages: records.messagesBySession.get(session.id) ?? [],
      sessionsById,
      projects: records.projects,
      recordDiagnostics: records.diagnostics,
      ctx: privateCtx,
    });
    expect(bundle.session.title).toBeUndefined();
  });

  test('subagent child carries parentId/relation/agentType/depth', async () => {
    const ctx = ctxFor('subagents');
    const records = await readOrigin(ctx, 'current');
    const child = records.sessions.find((s) => s.id === 'ses_child')!;
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session: child,
      messages: records.messagesBySession.get(child.id) ?? [],
      sessionsById,
      projects: records.projects,
      recordDiagnostics: records.diagnostics,
      ctx,
    });
    expect(bundle.session.parentId).toBe('opencode:current:ses_root');
    expect(bundle.session.relation).toBe('subagent');
    expect(bundle.session.agentType).toBe('forge-worker');
    expect(bundle.session.depth).toBe(1);
  });

  test('an unknown type with a long or multiline name yields a count-only diagnostic (no throw)', async () => {
    const ctx = ctxFor('small');
    const session: OpenCodeSession = {
      id: 'current-unknown',
      projectId: 'p',
      directory: '/home/u/proj',
    };
    const longType = 'x'.repeat(300);
    const messages: OpenCodeMessage[] = [
      { type: longType, seq: 1, data: {} },
      { type: 'a\nb', seq: 2, data: {} },
      { type: longType, seq: 3, data: {} },
    ];
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session,
      messages,
      sessionsById: new Map([[session.id, session]]),
      projects: new Map(),
      recordDiagnostics: [],
      ctx,
    });

    const diagnostic = bundle.diagnostics.find((d) => d.code === 'unknown-record-type');
    expect(diagnostic).toBeDefined();
    if (!diagnostic) throw new Error('expected an unknown-record-type diagnostic');
    expect(diagnostic.level).toBe('info');
    expect(diagnostic.count).toBe(3);
    expect(diagnostic.message).toBe('Saw 3 record(s) of an unrecognized type');
    expect(diagnostic.message.length).toBeLessThanOrEqual(200);
    expect(diagnostic.message.includes('\n')).toBe(false);
    expect(diagnostic.message.includes(longType)).toBe(false);
  });

  test('emits token-total-drift when the harness aggregate differs from the per-call sum', async () => {
    const ctx = ctxFor('small');
    const records = await readOrigin(ctx, 'current');
    const session = records.sessions[0]!;
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    // Force the harness-reported tokens_input to disagree with the Σ of call
    // steps (300 here).
    const drifted = { ...session, tokensInput: 500 };
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session: drifted,
      messages: records.messagesBySession.get(session.id) ?? [],
      sessionsById,
      projects: records.projects,
      recordDiagnostics: records.diagnostics,
      ctx,
    });
    expect(bundle.diagnostics.map((d) => d.code)).toContain('token-total-drift');
    // The session token field is still the per-call sum, never the harness total.
    expect(bundle.session.uncachedInput).toBe(300);
  });
});

describe('computeBundle - tool step model from the emitting assistant message', () => {
  test('a tool part from an assistant with data.model.id carries that model', async () => {
    const ctx = ctxFor('small');
    const session: OpenCodeSession = {
      id: 'current-tool-model',
      projectId: 'p',
      directory: '/home/u/proj',
    };
    const messages: OpenCodeMessage[] = [
      {
        type: 'assistant',
        seq: 1,
        data: {
          time: { created: 50, completed: 500 },
          model: { id: 'claude-sonnet-5' },
          content: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'Read',
              time: { created: 100, completed: 225 },
              state: { status: 'completed' },
            },
          ],
        },
      },
    ];
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session,
      messages,
      sessionsById: new Map([[session.id, session]]),
      projects: new Map(),
      recordDiagnostics: [],
      ctx,
    });
    const tool = bundle.steps.find((s) => s.kind === 'tool');
    expect(tool?.model).toBe('claude-sonnet-5');
  });

  test('a tool part from an assistant without a model leaves model undefined', async () => {
    const ctx = ctxFor('small');
    const session: OpenCodeSession = {
      id: 'current-tool-nomodel',
      projectId: 'p',
      directory: '/home/u/proj',
    };
    const messages: OpenCodeMessage[] = [
      {
        type: 'assistant',
        seq: 1,
        data: {
          time: { created: 50, completed: 500 },
          content: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'Read',
              time: { created: 100, completed: 225 },
              state: { status: 'completed' },
            },
          ],
        },
      },
    ];
    const bundle = await computeBundle({
      harnessId: 'opencode',
      origin: 'current',
      session,
      messages,
      sessionsById: new Map([[session.id, session]]),
      projects: new Map(),
      recordDiagnostics: [],
      ctx,
    });
    const tool = bundle.steps.find((s) => s.kind === 'tool');
    expect(tool?.model).toBeUndefined();
  });
});
