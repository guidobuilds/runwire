import type { LanesResponse } from '@runwire/core';
import { describe, expect, it } from 'vitest';
import short from './fixtures/short.json';
import { buildModel } from './model';

describe('lane model', () => {
  it('orders by time, agent index, then seq without mutating the response', () => {
    const data = structuredClone(short) as LanesResponse;
    const first = data.agents[0];
    if (!first) throw new Error('missing fixture agent');
    first.calls.at.fill('2026-01-01T00:00:00.000Z');
    first.calls.seq[0] = 2;
    first.calls.seq[1] = 1;
    const child = structuredClone(first);
    child.id = 'child';
    child.parentId = first.id;
    child.depth = 1;
    data.agents = [first, child];
    const before = JSON.stringify(data);
    const model = buildModel(data);
    expect(model.cols.slice(0, 3).map((c) => [c.agentId, c.seq, c.index])).toEqual([
      ['main', 1, 0],
      ['main', 2, 1],
      ['main', 3, 2],
    ]);
    expect(model.cols[110]?.agentId).toBe('child');
    expect(model.children.get('main')).toEqual(['child']);
    expect(model.byId.get('child')?.depth).toBe(1);
    expect(model.agents[0]?.cols[0]).toBe(model.cols[0]);
    expect(JSON.stringify(data)).toBe(before);
    expect(buildModel(data)).not.toBe(model);
  });

  it('derives context, marks, model and failure metadata, preserving unknowns', () => {
    const data = structuredClone(short) as LanesResponse;
    const calls = data.agents[0]?.calls;
    if (!calls) throw new Error('missing calls');
    calls.model[0] = -1;
    calls.promptInput[0] = null;
    calls.failed[0] = 3;
    calls.mcp[0] = 2;
    calls.skill[0] = 1;
    calls.spawns[0] = ['child'];
    const model = buildModel(data);
    expect(model.cols[0]).toMatchObject({
      index: 0,
      local: 0,
      agentId: 'main',
      seq: 1,
      model: null,
      contextWindow: null,
      tier: null,
      contextPercent: null,
      promptInput: null,
      output: 381,
      kind: 'exec',
      fails: 3,
      marks: { failures: 3, mcp: 2, skills: 1, subagents: 1 },
      spawns: ['child'],
    });
    expect(model.cols[1]).toMatchObject({
      model: 'claude-opus-5-5',
      tier: 'high',
      contextWindow: 1000000,
      promptInput: 58410,
    });
    expect(model.cols[1]?.contextPercent).toBeCloseTo(5.841);
    expect(buildModel({ ...data, agents: [], callCount: 0 }).cols).toEqual([]);
  });
});
