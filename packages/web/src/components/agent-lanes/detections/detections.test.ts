import type { LanesResponse } from '@runwire/core';
import { expect, it } from 'vitest';
import expected from '../fixtures/expected-detections.json';
import long from '../fixtures/long.json';
import nested from '../fixtures/nested.json';
import short from '../fixtures/short.json';
import tree3 from '../fixtures/tree3.json';
import tree17 from '../fixtures/tree17.json';
import { buildModel } from '../model';
import { contextThreshold } from './context-threshold';
import { failureGroup } from './failure-group';
import { highTierMechanical } from './high-tier-mechanical';
import { detect, rules } from './index';

function sample(n: number) {
  const data = structuredClone(short) as LanesResponse;
  const agent = data.agents[0];
  if (!agent) throw new Error('missing agent');
  for (const key of Object.keys(agent.calls) as (keyof typeof agent.calls)[]) {
    agent.calls[key].splice(n);
  }
  agent.calls.mechanical.fill(true);
  agent.calls.failed.fill(0);
  agent.calls.promptInput.fill(850000);
  return buildModel(data);
}

it('detects five mechanical high-tier calls, not four; flushes and excludes unknown tier', () => {
  expect(highTierMechanical(sample(4))).toEqual([]);
  expect(highTierMechanical(sample(5))).toEqual([
    {
      agentId: 'main',
      from: 0,
      to: 4,
      text: '5 calls in a row on claude-opus-5-5, only mechanical tools',
    },
  ]);
  const model = sample(12);
  const col = model.cols[5];
  if (!col) throw new Error('missing col');
  col.tier = null;
  expect(highTierMechanical(model).map((f) => [f.from, f.to])).toEqual([
    [0, 4],
    [6, 11],
  ]);
  col.tier = 'high';
  col.mechanical = false;
  expect(highTierMechanical(model).map((f) => [f.from, f.to])).toEqual([
    [0, 4],
    [6, 11],
  ]);
});
it('includes exact context threshold for three calls, excludes two and unknowns', () => {
  expect(contextThreshold(sample(2))).toEqual([]);
  expect(contextThreshold(sample(3))).toEqual([
    { agentId: 'main', from: 0, to: 2, text: '3 calls above 85%, peak 85% (850k tokens)' },
  ]);
  expect(contextThreshold(sample(3), 86)).toEqual([]);
  const model = sample(7);
  const col = model.cols[3];
  if (!col) throw new Error('missing col');
  col.contextPercent = null;
  expect(contextThreshold(model).map((f) => [f.from, f.to])).toEqual([
    [0, 2],
    [4, 6],
  ]);
});
it('groups failure steps at exactly ten local calls apart, transitively, and splits at eleven', () => {
  const model = sample(32);
  for (const i of [0, 10, 20, 31]) {
    const col = model.cols[i];
    if (col) col.fails = 1;
  }
  expect(failureGroup(model)).toEqual([
    { agentId: 'main', from: 0, to: 20, text: '3 failed tool steps across 3 calls' },
  ]);
  const first = model.cols[0];
  if (!first) throw new Error('missing col');
  first.fails = 3;
  expect(
    failureGroup({ ...model, agents: [{ ...model.agents[0], id: 'main', cols: [first] }] }),
  ).toEqual([{ agentId: 'main', from: 0, to: 0, text: '3 failed tool steps across 1 calls' }]);
  first.fails = 2;
  expect(
    failureGroup({ ...model, agents: [{ ...model.agents[0], id: 'main', cols: [first] }] }),
  ).toEqual([]);
});
it('declares indicator dependencies and preserves stable finding order for equal starts', () => {
  expect(rules.map((r) => [r.id, r.indicators])).toEqual([
    ['high-tier-mechanical', ['model-changes']],
    ['context-threshold', ['context']],
    ['failure-group', ['failures']],
  ]);
  const model = sample(5);
  const first = model.cols[0];
  if (first) first.fails = 3;
  expect(detect(model).map((f) => f.text)).toEqual([
    '5 calls in a row on claude-opus-5-5, only mechanical tools',
    '5 calls above 85%, peak 85% (850k tokens)',
    '3 failed tool steps across 1 calls',
  ]);
  expect(detect(model, [], 85)).toEqual([]);
});

const samples = { short, long, tree3, tree17, nested };
it.each(Object.keys(samples) as (keyof typeof samples)[])(
  'S19: matches prototype agent/range/order for %s',
  (id) => {
    const actual = detect(buildModel(samples[id] as LanesResponse));
    const ranges = (findings: { agentId: string; from: number; to: number }[]) =>
      findings.map(({ agentId, from, to }) => ({ agentId, from, to }));
    expect(ranges(actual)).toEqual(ranges(expected[id]));
    const normalize = (text: string) =>
      text
        .replace(/, only .+$/, ', only mechanical tools')
        .replace(/(failed tool steps across \d+ calls) \(.+\)$/, '$1');
    expect(actual.map((f) => normalize(f.text))).toEqual(
      expected[id].map((f) => normalize(f.text)),
    );
  },
);
