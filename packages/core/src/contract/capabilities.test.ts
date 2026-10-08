import { describe, expect, test } from 'bun:test';
import { CAPABILITIES, CAPABILITY_FIELDS } from './capabilities';
import type { StepKind } from './types';

const ALL_STEP_KINDS: readonly StepKind[] = [
  'call',
  'tool',
  'turn',
  'harness',
  'compaction',
  'model-change',
  'mode-change',
];

describe('CAPABILITY_FIELDS exhaustiveness', () => {
  test('every Capability has an entry, and no extra entries exist', () => {
    const keys = Object.keys(CAPABILITY_FIELDS);
    expect(keys.length).toBe(CAPABILITIES.length);
    for (const cap of CAPABILITIES) {
      expect(CAPABILITY_FIELDS[cap]).toBeDefined();
    }
    for (const key of keys) {
      expect(CAPABILITIES).toContain(key as (typeof CAPABILITIES)[number]);
    }
  });

  test('every gated session field appears in exactly one capability', () => {
    const seen = new Map<string, string>();
    for (const cap of CAPABILITIES) {
      for (const field of CAPABILITY_FIELDS[cap].sessionFields) {
        const owner = seen.get(field);
        expect(owner).toBeUndefined();
        seen.set(field, cap);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  test('every gated step field (kind.field) appears in exactly one capability', () => {
    const seen = new Map<string, string>();
    for (const cap of CAPABILITIES) {
      for (const field of CAPABILITY_FIELDS[cap].stepFields) {
        const owner = seen.get(field);
        expect(owner).toBeUndefined();
        seen.set(field, cap);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  test('MCP identity fields are gated by toolCalls (so an adapter emitting them must declare it)', () => {
    expect(CAPABILITY_FIELDS.toolCalls.stepFields).toContain('tool.mcpServer');
    expect(CAPABILITY_FIELDS.toolCalls.stepFields).toContain('tool.mcpTool');
  });

  test('every StepKind is owned by exactly one capability', () => {
    const seen = new Map<StepKind, string>();
    for (const cap of CAPABILITIES) {
      for (const kind of CAPABILITY_FIELDS[cap].stepKinds) {
        const owner = seen.get(kind);
        expect(owner).toBeUndefined();
        seen.set(kind, cap);
      }
    }
    for (const kind of ALL_STEP_KINDS) {
      expect(seen.has(kind)).toBe(true);
    }
    expect(seen.size).toBe(ALL_STEP_KINDS.length);
  });
});
