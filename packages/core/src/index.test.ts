import { expect, test } from 'bun:test';
import type { Diagnostic, HarnessAdapter } from './index';
import { DiagnosticSchema, makeDiagnostic, ToolCategorySchema, VERSION } from './index';

test('core exports a version placeholder', () => {
  expect(VERSION).toBe('0.0.0');
});

test('the exported HarnessAdapter is the contract shape', () => {
  const adapter: HarnessAdapter = {
    id: 'x',
    displayName: 'x',
    adapterVersion: '1.0.0',
    capabilities: [],
    allowlist: {},
    async probe() {
      return { installed: true, roots: [], notes: [] };
    },
    async *discover() {},
  };
  expect(adapter.id).toBe('x');
});

test('makeDiagnostic and DiagnosticSchema agree on the contract Diagnostic shape (no harness/path)', () => {
  const d: Diagnostic = makeDiagnostic('info', 'x', 'a message');
  const result = DiagnosticSchema.safeParse(d);
  expect(result.success).toBe(true);
});

test('ToolCategorySchema is exported and validates the tool category union', () => {
  expect(ToolCategorySchema.safeParse('read').success).toBe(true);
  expect(ToolCategorySchema.safeParse('not-a-category').success).toBe(false);
});
