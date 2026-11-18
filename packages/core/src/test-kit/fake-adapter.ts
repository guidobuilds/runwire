import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter, Known } from '../contract/adapter';
import type { SessionBundle } from '../contract/types';

export type CreateFakeAdapterOptions = {
  installed?: boolean;
  includeInvalid?: boolean;
  scenarios?: string[];
};

const SAMPLE_TITLE = 'A fake session title';

type ScenarioDef = {
  id: string;
  sourceSize: number;
  sourceMtime: number;
  bundle: (ctx: AdapterContext) => SessionBundle;
};

const PROJECT = { key: 'k', name: 'k', identity: 'cwd' as const };

function sourcePathFor(id: string): string {
  return `/fake/${id}.jsonl`;
}

function baseScenarios(): ScenarioDef[] {
  return [
    {
      id: 'root',
      sourceSize: 1000,
      sourceMtime: 1000,
      bundle: (ctx): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:root',
          harnessId: 'fake',
          projectKey: 'k',
          depth: 0,
          title: ctx.privacy.titles ? SAMPLE_TITLE : undefined,
          cwd: '/home/u/proj',
          gitBranch: 'main',
          gitCommit: 'abc123',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:20:00.000Z',
          durationMs: 1_200_000,
          modelPrimary: 'fake-model-b',
          modelChanges: 1,
          modePrimary: 'auto',
          modeChanges: 1,
          effort: 'high',
          uncachedInput: 30,
          cachedInput: 5,
          cacheWrite: 2,
          output: 250,
          reasoningOutput: 3,
          turns: 1,
          apiCalls: 2,
          toolCalls: 4,
          compactions: 1,
          costUsd: 0.42,
          initiatorKind: 'machine',
          initiatorSurface: 'sdk',
          initiatorAutomation: 'sdk',
          harnessVersionFirst: '1.0.0',
          harnessVersionLast: '1.0.1',
          sourcePath: sourcePathFor('root'),
          sourceSize: 1000,
          sourceMtime: 1000,
        },
        steps: [
          {
            sessionId: 'fake:root',
            seq: 0,
            at: '2026-01-01T00:00:00.000Z',
            kind: 'call',
            model: 'fake-model-a',
            uncachedInput: 10,
            cachedInput: 2,
            cacheWrite: 1,
            output: 100,
            reasoningOutput: 1,
          },
          {
            sessionId: 'fake:root',
            seq: 1,
            at: '2026-01-01T00:01:00.000Z',
            kind: 'call',
            model: 'fake-model-b',
            uncachedInput: 20,
            cachedInput: 3,
            cacheWrite: 1,
            output: 150,
            reasoningOutput: 2,
          },
          {
            sessionId: 'fake:root',
            seq: 2,
            at: '2026-01-01T00:01:00.000Z',
            kind: 'model-change',
            fromValue: 'fake-model-a',
            toValue: 'fake-model-b',
          },
          {
            sessionId: 'fake:root',
            seq: 3,
            at: '2026-01-01T00:02:00.000Z',
            kind: 'tool',
            toolCategory: 'read',
            toolName: 'read-thing',
            callId: 'r1',
            durationMs: 5,
            error: false,
          },
          {
            sessionId: 'fake:root',
            seq: 4,
            at: '2026-01-01T00:03:00.000Z',
            kind: 'tool',
            toolCategory: 'agent',
            toolName: 'spawn-agent',
            callId: 'c1',
          },
          {
            sessionId: 'fake:root',
            seq: 5,
            at: '2026-01-01T00:04:00.000Z',
            kind: 'tool',
            toolCategory: 'agent',
            toolName: 'spawn-agent',
            callId: 'c-decoy',
          },
          {
            sessionId: 'fake:root',
            seq: 6,
            at: '2026-01-01T00:05:00.000Z',
            kind: 'tool',
            toolCategory: 'agent',
            toolName: 'spawn-agent',
            callId: 'c2',
          },
          {
            sessionId: 'fake:root',
            seq: 7,
            at: '2026-01-01T00:06:00.000Z',
            kind: 'turn',
            durationMs: 1000,
          },
          {
            sessionId: 'fake:root',
            seq: 8,
            at: '2026-01-01T00:07:00.000Z',
            kind: 'compaction',
            compactionTrigger: 'auto',
            preTokens: 500,
            postTokens: 50,
          },
          {
            sessionId: 'fake:root',
            seq: 9,
            at: '2026-01-01T00:08:00.000Z',
            kind: 'harness',
            toolName: 'hook:PreToolUse',
          },
          {
            sessionId: 'fake:root',
            seq: 10,
            at: '2026-01-01T00:09:00.000Z',
            kind: 'mode-change',
            fromValue: 'manual',
            toValue: 'auto',
          },
        ],
        diagnostics: [],
      }),
    },
    {
      id: 'child1',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:child1',
          harnessId: 'fake',
          projectKey: 'k',
          parentId: 'fake:root',
          relation: 'subagent',
          depth: 1,
          agentType: 'fake-explorer',
          spawnCallId: 'c1',
          apiCalls: 1,
          output: 20,
          sourcePath: sourcePathFor('child1'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [
          {
            sessionId: 'fake:child1',
            seq: 0,
            kind: 'call',
            model: 'fake-model-a',
            output: 20,
          },
        ],
        diagnostics: [],
      }),
    },
    {
      id: 'child2',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:child2',
          harnessId: 'fake',
          projectKey: 'k',
          parentId: 'fake:root',
          relation: 'subagent',
          depth: 1,
          agentType: 'fake-explorer',
          sourcePath: sourcePathFor('child2'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [],
        diagnostics: [],
      }),
    },
    {
      id: 'child3',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:child3',
          harnessId: 'fake',
          projectKey: 'k',
          parentId: 'fake:root',
          relation: 'subagent',
          depth: 1,
          agentType: 'fake-explorer',
          spawnCallId: 'c2',
          sourcePath: sourcePathFor('child3'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [],
        diagnostics: [],
      }),
    },
    {
      id: 'child4',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:child4',
          harnessId: 'fake',
          projectKey: 'k',
          parentId: 'fake:root',
          relation: 'subagent',
          depth: 1,
          agentType: 'fake-explorer',
          spawnCallId: 'c2',
          sourcePath: sourcePathFor('child4'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [],
        diagnostics: [],
      }),
    },
    {
      id: 'grandchild',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:grandchild',
          harnessId: 'fake',
          projectKey: 'k',
          parentId: 'fake:child1',
          relation: 'subagent',
          depth: 2,
          agentType: 'fake-nested',
          sourcePath: sourcePathFor('grandchild'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [],
        diagnostics: [],
      }),
    },
    {
      id: 'orphan',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:orphan',
          harnessId: 'fake',
          projectKey: 'k',
          parentId: 'fake:ghost',
          relation: 'subagent',
          depth: 1,
          agentType: 'fake-orphan',
          sourcePath: sourcePathFor('orphan'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [],
        diagnostics: [],
      }),
    },
    {
      id: 'diagnosed',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:diagnosed',
          harnessId: 'fake',
          projectKey: 'k',
          depth: 0,
          sourcePath: sourcePathFor('diagnosed'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [],
        diagnostics: [{ level: 'warn', code: 'fake-diagnostic', message: 'a fake diagnostic' }],
      }),
    },
    {
      id: 'titled',
      sourceSize: 200,
      sourceMtime: 1000,
      bundle: (ctx): SessionBundle => ({
        project: PROJECT,
        session: {
          id: 'fake:titled',
          harnessId: 'fake',
          projectKey: 'k',
          depth: 0,
          title: ctx.privacy.titles ? SAMPLE_TITLE : undefined,
          cwd: '/home/u/titled',
          apiCalls: 1,
          output: 1,
          sourcePath: sourcePathFor('titled'),
          sourceSize: 200,
          sourceMtime: 1000,
        },
        steps: [{ sessionId: 'fake:titled', seq: 0, kind: 'call', output: 1 }],
        diagnostics: [],
      }),
    },
  ];
}

function invalidScenario(): ScenarioDef {
  return {
    id: 'invalid',
    sourceSize: 200,
    sourceMtime: 1000,
    bundle: (): SessionBundle => ({
      project: PROJECT,
      session: {
        id: 'fake:invalid',
        harnessId: 'fake',
        projectKey: 'k',
        depth: 0,
        sourcePath: sourcePathFor('invalid'),
        sourceSize: 200,
        sourceMtime: 1000,
      },
      steps: [{ sessionId: 'fake:invalid', seq: -1, kind: 'turn' }],
      diagnostics: [],
    }),
  };
}

export function createFakeAdapter(opts: CreateFakeAdapterOptions = {}): HarnessAdapter {
  let all = baseScenarios();
  if (opts.includeInvalid) all = [...all, invalidScenario()];
  const scenarioIds = opts.scenarios;
  const active = scenarioIds ? all.filter((s) => scenarioIds.includes(s.id)) : all;

  return {
    id: 'fake',
    displayName: 'Fake (test-kit)',
    adapterVersion: '1.0.0',
    capabilities: [
      'usage.perCall',
      'usage.cumulative',
      'usage.cacheWrite',
      'usage.reasoning',
      'timing',
      'model',
      'mode',
      'effort',
      'version',
      'turns',
      'toolCalls',
      'compactions',
      'subagents',
      'cost',
      'title',
      'git',
      'initiator',
      'steps.errors',
      'steps.harness',
      'steps.toolDurations',
    ],
    allowlist: {},

    async probe() {
      return { installed: opts.installed ?? true, roots: ['/fake'], notes: [] };
    },

    async *discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
      for (const scenario of active) {
        const path = sourcePathFor(scenario.id);
        const stored = known.get(path);
        if (
          stored &&
          stored.size === scenario.sourceSize &&
          stored.mtime === scenario.sourceMtime
        ) {
          continue;
        }
        yield scenario.bundle(ctx);
      }
    },
  };
}
