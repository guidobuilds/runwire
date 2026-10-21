import type { LanesResponse } from '@runwire/core';
import { expect, it } from 'vitest';
import fixture from '../fixtures/short.json';
import { buildModel } from '../model';
import { compactions } from './compactions';
import { context } from './context';
import { failures } from './failures';
import { idle } from './idle';
import { indicators } from './index';
import { mcp } from './mcp';
import { modelChanges } from './model-changes';
import { skills } from './skills';
import { subagents } from './subagents';

function sample() {
  const data = structuredClone(fixture) as LanesResponse;
  const agent = data.agents[0];
  if (!agent) throw new Error('missing agent');
  for (const key of Object.keys(agent.calls) as (keyof typeof agent.calls)[]) {
    agent.calls[key].splice(2);
  }
  agent.calls.at = ['2026-01-01T00:00:00.000Z', '2026-01-01T00:30:00.001Z'];
  agent.calls.model[1] = -1;
  agent.calls.failed = [2, 0];
  agent.calls.skill = [3, 0];
  agent.calls.mcp = [4, 0];
  agent.calls.kind[0] = 'agent';
  agent.calls.spawns[0] = ['child', 'missing'];
  agent.calls.events[0] = [
    { kind: 'compaction', trigger: 'manual', preTokens: 900, postTokens: 100 },
    { kind: 'model-change', from: 'a', to: 'b', after: true },
  ];
  const child = structuredClone(agent);
  child.id = 'child';
  child.parentId = 'main';
  for (const key of Object.keys(child.calls) as (keyof typeof child.calls)[]) {
    child.calls[key].splice(1);
  }
  child.calls.spawns[0] = null;
  child.calls.kind[0] = 'reply';
  child.calls.at[0] = '2026-01-01T00:00:00.000Z';
  data.agents = [agent, child];
  return buildModel(data);
}

it('provides context percentages and explicit null for an unknown model', () => {
  expect(context(sample()).map((p) => p.value)).toEqual([4.9281, 4.9281, null]);
});
it('provides subagent marks and linked or unresolved spawn anchors', () => {
  expect(subagents(sample())[0]).toMatchObject({
    agentId: 'main',
    index: 0,
    count: 2,
    connectors: [
      { childId: 'child', index: 1 },
      { childId: 'missing', index: null },
    ],
  });
});
it.each([
  ['skills', skills, 3],
  ['mcp', mcp, 4],
  ['failures', failures, 2],
] as const)('provides %s marks and counts', (_id, indicator, count) => {
  expect(indicator(sample()).map((m) => [m.agentId, m.index, m.count])).toEqual([
    ['main', 0, count],
    ['child', 1, count],
  ]);
});
it('preserves compaction metadata and before/after position', () => {
  expect(compactions(sample())[0]).toMatchObject({
    agentId: 'main',
    index: 0,
    position: 'before',
    event: { kind: 'compaction', trigger: 'manual', preTokens: 900, postTokens: 100 },
  });
});
it('preserves dashed model-change event metadata', () => {
  expect(modelChanges(sample())[0]).toMatchObject({
    index: 0,
    position: 'after',
    dashed: true,
    event: { from: 'a', to: 'b' },
  });
});
it('cuts only global gaps strictly above 30 minutes, without extra columns', () => {
  const model = sample();
  expect(idle(model)).toEqual([{ from: 1, to: 2, duration: 1800001 }]);
  const last = model.cols[2];
  if (!last) throw new Error('missing col');
  last.at -= 1;
  expect(idle(model)).toEqual([]);
  expect(model.cols).toHaveLength(3);
});
it('registers all eight pure indicators with renderer metadata and meaningful counts', () => {
  const model = sample();
  expect(indicators.map((i) => [i.id, i.count(model)])).toEqual([
    ['context', 2],
    ['subagents', 2],
    ['skills', 6],
    ['mcp', 8],
    ['compactions', 2],
    ['model-changes', 2],
    ['failures', 4],
    ['idle', 1],
  ]);
  for (const indicator of indicators) {
    expect(indicator.name.length).toBeGreaterThan(0);
    expect(indicator.colorToken).toMatch(/^--lane-/);
    expect(indicator.shape.length).toBeGreaterThan(0);
  }
});
