import { describe, expect, test } from 'bun:test';
import { sessionDetailsSchema, sessionSummarySchema } from './types';

const summary = {
  sourceId: 'opencode:current:ses_x',
  sourceLocator: '/home/u/.local/share/opencode/opencode.db',
  dbOrigin: 'current',
  id: 'opencode:current:ses_x',
  projectKey: 'github.com/acme/proj',
  title: 'My session',
  agent: 'build',
  modelPrimary: 'gpt-5.6-sol',
  depth: 0,
  startedAt: '2026-09-02T16:36:40.100Z',
  updatedAt: '2026-09-02T16:36:43.500Z',
  costUsd: 0.1,
  tokens: { uncachedInput: 300, cachedInput: 0, cacheWrite: 0, output: 50, reasoningOutput: 10 },
  turns: 2,
  apiCalls: 1,
  toolCalls: 1,
  children: [],
};

describe('connector types', () => {
  test('sessionSummarySchema validates a metadata-only summary', () => {
    const r = sessionSummarySchema.safeParse(summary);
    expect(r.success).toBe(true);
  });

  test('sessionSummarySchema rejects a content-bearing field', () => {
    const r = sessionSummarySchema.safeParse({
      ...summary,
      content: [{ type: 'text', text: 'SECRET' }],
    });
    expect(r.success).toBe(false);
  });

  test('sessionDetailsSchema validates a CORE-representable SessionDetails', () => {
    const details = {
      harnessId: 'opencode',
      sourceId: 'opencode:current:ses_x',
      sourceLocator: '/home/u/.local/share/opencode/opencode.db',
      dbOrigin: 'current',
      project: { key: 'github.com/acme/proj', name: 'proj', identity: 'remote' },
      session: {
        id: 'opencode:current:ses_x',
        harnessId: 'opencode',
        projectKey: 'github.com/acme/proj',
        depth: 0,
        sourcePath: 'opencode:current:ses_x',
        sourceId: 'opencode:current:ses_x',
        sourceLocator: '/home/u/.local/share/opencode/opencode.db',
        sourceSize: 2,
        sourceMtime: 1,
      },
      steps: [{ sessionId: 'opencode:current:ses_x', seq: 0, kind: 'turn' }],
      diagnostics: [],
    };
    const r = sessionDetailsSchema.safeParse(details);
    expect(r.success).toBe(true);
  });

  test('sessionDetailsSchema rejects a content-bearing step field', () => {
    const details = {
      harnessId: 'opencode',
      sourceId: 'opencode:current:ses_x',
      sourceLocator: 'x',
      dbOrigin: 'current',
      project: { key: 'k', name: 'n', identity: 'cwd' },
      session: {
        id: 'opencode:current:ses_x',
        harnessId: 'opencode',
        projectKey: 'k',
        depth: 0,
        sourcePath: 'opencode:current:ses_x',
        sourceSize: 1,
        sourceMtime: 1,
      },
      steps: [
        {
          sessionId: 'opencode:current:ses_x',
          seq: 0,
          kind: 'tool',
          toolName: 'x',
          text: 'SECRET',
        },
      ],
      diagnostics: [],
    };
    const r = sessionDetailsSchema.safeParse(details);
    expect(r.success).toBe(false);
  });
});
