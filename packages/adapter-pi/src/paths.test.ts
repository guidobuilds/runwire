import { describe, expect, test } from 'bun:test';
import type { AdapterContext } from '@runwire/core';
import { createMemoryFs } from '@runwire/core';
import { agentDir, decodeProjectDirname, sessionIdFromRootFile, sessionsRoot } from './paths';

function ctx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

describe('paths: sessionIdFromRootFile', () => {
  test('takes the uuid after the timestamp, not the whole basename', () => {
    expect(
      sessionIdFromRootFile('2026-09-08T15-34-04-313Z_01a081a7-ab18-4c5d-8e2f-aabbccddeeff.jsonl'),
    ).toBe('01a081a7-ab18-4c5d-8e2f-aabbccddeeff');
  });
});

describe('paths: decodeProjectDirname', () => {
  test('strips the surrounding -- and decodes separators', () => {
    expect(decodeProjectDirname('--home-u-pi--')).toBe('/home/u/pi');
  });
});

describe('paths: agentDir / sessionsRoot', () => {
  test('default to <home>/.pi/agent and <agentDir>/sessions', () => {
    const c = ctx();
    expect(agentDir(c)).toBe('/home/u/.pi/agent');
    expect(sessionsRoot(c)).toBe('/home/u/.pi/agent/sessions');
  });

  test('PI_CODING_AGENT_DIR moves both the agent dir and the default sessions root', () => {
    const c = ctx({ env: { PI_CODING_AGENT_DIR: '/x' } });
    expect(agentDir(c)).toBe('/x');
    expect(sessionsRoot(c)).toBe('/x/sessions');
  });

  test('PI_CODING_AGENT_SESSION_DIR overrides the sessions root directly', () => {
    const c = ctx({ env: { PI_CODING_AGENT_SESSION_DIR: '/y' } });
    expect(sessionsRoot(c)).toBe('/y');
  });
});
