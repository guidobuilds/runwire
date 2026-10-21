import { describe, expect, test } from 'bun:test';
import type { ToolCategory } from '@runwire/core';
import { piToolCategory } from './tool-category';

const BUILT_INS: Array<[string, ToolCategory]> = [
  ['read', 'read'],
  ['ls', 'read'],
  ['grep', 'search'],
  ['find', 'search'],
  ['edit', 'write'],
  ['write', 'write'],
  ['bash', 'exec'],
  ['powershell', 'exec'],
];

describe('piToolCategory: built-in tools', () => {
  test.each(BUILT_INS)('%s -> %s', (name, expected) => {
    expect(piToolCategory(name)).toBe(expected);
  });
});

describe('piToolCategory: vocabulary boundary', () => {
  test('built-in names are exact, not prefixes, aliases or normalized input', () => {
    expect(piToolCategory('')).toBe('other');
    for (const [name, category] of BUILT_INS) {
      expect(piToolCategory(name)).toBe(category);
      for (const unknown of [`${name}_extra`, `extra_${name}`, name.toUpperCase(), ` ${name}`]) {
        expect(piToolCategory(unknown)).toBe('other');
      }
    }
  });
});

describe('piToolCategory: extension tools', () => {
  test('subagent_run / subagent_list_agents are counted as agent (D81: counted, not linked)', () => {
    expect(piToolCategory('subagent_run')).toBe('agent');
    expect(piToolCategory('subagent_list_agents')).toBe('agent');
  });

  test('todo -> plan, read_symbol -> read', () => {
    expect(piToolCategory('todo')).toBe('plan');
    expect(piToolCategory('read_symbol')).toBe('read');
  });

  test('an unknown extension name degrades to other', () => {
    expect(piToolCategory('gentle_review')).toBe('other');
    expect(piToolCategory('lens_diagnostics')).toBe('other');
  });
});
