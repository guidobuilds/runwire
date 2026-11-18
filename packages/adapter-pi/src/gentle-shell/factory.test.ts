import { describe, expect, test } from 'bun:test';
import type { Capability, HarnessAdapter } from '@runwire/core';
import { createPiAdapter } from '../index';
import { piAllowlist } from '../pi/allowlist';
import { gentleShellAllowlist } from './allowlist';
import { createGentleShellAdapter } from './index';

describe('gentle-shell factory (skeleton)', () => {
  test('satisfies the HarnessAdapter contract', () => {
    const adapter: HarnessAdapter = createGentleShellAdapter();
    expect(adapter.id).toBe('gentle-shell');
    expect(adapter.displayName).toBe('Gentle Shell');
    expect(adapter.adapterVersion).toBe('1.0.0');
  });

  test('declares exactly the 16 capabilities of gentle-shell.md §4.1', () => {
    const adapter = createGentleShellAdapter();
    const expected: readonly Capability[] = [
      'usage.perCall',
      'usage.cumulative',
      'usage.cacheWrite',
      'usage.reasoning',
      'timing',
      'model',
      'effort',
      'turns',
      'toolCalls',
      'compactions',
      'subagents',
      'cost',
      'initiator',
      'steps.errors',
      'steps.harness',
      'steps.toolDurations',
    ];
    expect([...adapter.capabilities].sort()).toEqual([...expected].sort());
    expect(adapter.capabilities).not.toContain('mode');
    expect(adapter.capabilities).not.toContain('version');
    expect(adapter.capabilities).not.toContain('title');
    expect(adapter.capabilities).not.toContain('git');
  });

  test('is a strict superset of the Pi allowlist with the §7 additions', () => {
    const keysOf = (p: unknown, prefix = ''): string[] => {
      if (p === true || p === null || typeof p !== 'object') return [prefix];
      const entries = Array.isArray(p) ? p.map((v) => ['[]', v]) : Object.entries(p);
      return entries.flatMap(([k, v]) => keysOf(v, `${prefix}.${k}`));
    };
    const piKeys = new Set(keysOf(piAllowlist));
    const shellKeys = new Set(keysOf(gentleShellAllowlist));
    for (const key of piKeys) expect(shellKeys.has(key), `missing: ${key}`).toBe(true);
    for (const key of [
      '.kind',
      '.customType',
      '.message.thinkingLevel',
      '.message.durationMs',
      '.message.nestedCalls.complete',
      '.message.nestedCalls.calls.[].name',
      '.message.details.gentleAgents.taskId',
    ]) {
      expect(shellKeys.has(key), `expected §7 addition: ${key}`).toBe(true);
      expect(piKeys.has(key), `Pi must not project: ${key}`).toBe(false);
    }
  });

  test('the Pi adapter is untouched (the skeleton is additive)', () => {
    const adapter = createPiAdapter();
    expect(adapter.id).toBe('pi');
    expect(adapter.displayName).toBe('Pi');
    expect(adapter.adapterVersion).toBe('1.1.0');
    expect(adapter.capabilities).toHaveLength(14);
    expect(adapter.capabilities).not.toContain('subagents');
    expect(adapter.allowlist).toBe(piAllowlist);
  });
});
