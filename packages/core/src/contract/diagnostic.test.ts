import { expect, test } from 'bun:test';
import { makeDiagnostic } from './diagnostic';

test('makeDiagnostic builds a plain diagnostic with no harness/path', () => {
  const d = makeDiagnostic('warn', 'orphan-child', 'parent not found');
  expect(d).toEqual({ level: 'warn', code: 'orphan-child', message: 'parent not found' });
});

test('makeDiagnostic accepts optional line and count', () => {
  const d = makeDiagnostic('error', 'malformed-json-line', 'bad json', { line: 12, count: 3 });
  expect(d.line).toBe(12);
  expect(d.count).toBe(3);
});

test('makeDiagnostic rejects newlines', () => {
  expect(() => makeDiagnostic('info', 'x', 'line one\nline two')).toThrow();
});

test('makeDiagnostic rejects messages over 200 characters', () => {
  expect(() => makeDiagnostic('info', 'x', 'a'.repeat(201))).toThrow();
});

test('makeDiagnostic accepts exactly 200 characters', () => {
  const d = makeDiagnostic('info', 'x', 'a'.repeat(200));
  expect(d.message.length).toBe(200);
});
